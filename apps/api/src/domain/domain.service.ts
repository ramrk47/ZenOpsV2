import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import type { JwtClaims } from '@zenops/auth';
import type {
  BankBranchCreate,
  BankCreate,
  AssignmentAssigneeAdd,
  AssignmentAttachDocument,
  AssignmentCreate,
  AssignmentListQuery,
  AssignmentMessageCreate,
  AssignmentStatusChange,
  AnalyticsOverview,
  AssignmentTaskCreate,
  AssignmentTaskUpdate,
  AssignmentTransition,
  AssignmentUpdate,
  AttendanceMark,
  ChannelCreate,
  ChannelRequestCreate,
  ChannelRequestUpdate,
  ClientOrgCreate,
  ContactCreate,
  DocumentListQuery,
  DocumentMetadataPatch,
  DocumentTagsUpsert,
  EmployeeRoleAssign,
  BillingInvoiceMarkPaid,
  EmployeeCreate,
  FileConfirmUploadRequest,
  FilePresignUploadRequest,
  MasterDataSearchQuery,
  NotificationRouteCreate,
  PropertyCreate,
  BranchContactCreate,
  TaskCreate,
  TaskListQuery,
  TaskUpdate,
  RoleContactPointUpsert,
  PayrollItemCreate,
  PayrollPeriodCreate,
  ReportDataBundlePatch,
  ReportRequestCreate,
  TenantCreate,
  UserCreate,
  WorkOrderCreate
} from '@zenops/contracts';
import { Prisma, type TxClient } from '@zenops/db';
import { buildStorageKey, type StorageProvider } from '@zenops/storage';
import type { LaunchModeConfig } from '../common/launch-mode.js';
import { BillingService } from '../billing/billing.service.js';
import { BillingControlService } from '../billing-control/billing-control.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { Capabilities } from '../auth/rbac.js';
import { AssignmentSignalsQueueService } from '../queue/assignment-signals-queue.service.js';

export interface QueueResult {
  reportRequestId: string;
  reportJobId: string;
  tenantId: string;
  alreadyQueued: boolean;
}

interface PendingUploadContext {
  purpose: 'evidence' | 'reference' | 'photo' | 'annexure' | 'other';
  work_order_id?: string;
  assignment_id?: string;
  report_request_id?: string;
  employee_id?: string;
}

const PENDING_UPLOAD_CONTEXT_KEY = '_pending_upload_context';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const asJsonRecord = (value: Prisma.JsonValue | null): Record<string, unknown> => {
  if (isRecord(value)) {
    return value;
  }
  return {};
};

const parseDateOnly = (value: string | null | undefined): Date | null => {
  if (value === undefined || value === null) {
    return null;
  }
  return new Date(`${value}T00:00:00.000Z`);
};

const toDateOnly = (value: Date | null | undefined): string | null => {
  if (!value) {
    return null;
  }
  return value.toISOString().slice(0, 10);
};

const ASSIGNMENT_STAGE_SEQUENCE = [
  'draft_created',
  'data_collected',
  'qc_pending',
  'qc_changes_requested',
  'qc_approved',
  'finalized',
  'sent_to_client',
  'billed',
  'paid',
  'closed'
] as const;

type AssignmentStageValue = (typeof ASSIGNMENT_STAGE_SEQUENCE)[number];

const ASSIGNMENT_ALLOWED_TRANSITIONS: Record<AssignmentStageValue, AssignmentStageValue[]> = {
  draft_created: ['data_collected'],
  data_collected: ['qc_pending'],
  qc_pending: ['qc_changes_requested', 'qc_approved'],
  qc_changes_requested: ['data_collected'],
  qc_approved: ['finalized', 'sent_to_client'],
  finalized: ['sent_to_client'],
  sent_to_client: ['billed'],
  billed: ['paid'],
  paid: ['closed'],
  closed: []
};

const LIFECYCLE_STATUS_TO_STAGE: Record<
  'DRAFT' | 'COLLECTING' | 'QC_PENDING' | 'CHANGES_REQUESTED' | 'QC_APPROVED' | 'DELIVERED' | 'BILLED' | 'PAID' | 'CLOSED',
  AssignmentStageValue
> = {
  DRAFT: 'draft_created',
  COLLECTING: 'data_collected',
  QC_PENDING: 'qc_pending',
  CHANGES_REQUESTED: 'qc_changes_requested',
  QC_APPROVED: 'qc_approved',
  DELIVERED: 'sent_to_client',
  BILLED: 'billed',
  PAID: 'paid',
  CLOSED: 'closed'
};

const assignmentSignalKinds = ['overdue', 'stuck_in_qc', 'billing_pending'] as const;

const utcDateBucket = (value = new Date()): string => {
  return value.toISOString().slice(0, 10).replaceAll('-', '');
};

@Injectable()
export class DomainService {
  constructor(
    @Inject('STORAGE_PROVIDER') private readonly storageProvider: StorageProvider,
    @Inject('LAUNCH_MODE_CONFIG') private readonly launchMode: LaunchModeConfig,
    private readonly billingService: BillingService,
    private readonly billingControlService: BillingControlService,
    private readonly notificationsService: NotificationsService,
    private readonly assignmentSignalsQueue: AssignmentSignalsQueueService
  ) {}

  async listTenants(tx: TxClient) {
    return tx.tenant.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  async createTenant(tx: TxClient, input: TenantCreate) {
    return tx.tenant.create({ data: { slug: input.slug, name: input.name, lane: input.lane } });
  }

  async softDeleteTenant(tx: TxClient, id: string) {
    return tx.tenant.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async listUsers(tx: TxClient) {
    return tx.user.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  async createUser(tx: TxClient, input: UserCreate) {
    return tx.user.create({ data: input });
  }

  async listBanks(tx: TxClient, claims: JwtClaims, query: MasterDataSearchQuery) {
    this.assertCapability(claims, Capabilities.masterDataRead);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const rows = await tx.bank.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { code: { contains: query.search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
      take: query.limit
    });

    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      name: row.name,
      code: row.code,
      is_verified: row.isVerified,
      reviewed_at: row.reviewedAt?.toISOString() ?? null,
      reviewed_by_user_id: row.reviewedByUserId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    }));
  }

  async createBank(tx: TxClient, claims: JwtClaims, input: BankCreate) {
    this.assertCapability(claims, Capabilities.masterDataWrite);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const row = await tx.bank.upsert({
      where: {
        tenantId_name: {
          tenantId,
          name: input.name
        }
      },
      update: {
        code: input.code ?? null,
        deletedAt: null
      },
      create: {
        tenantId,
        name: input.name,
        code: input.code ?? null,
        isVerified: claims.roles.includes('super_admin')
      }
    });

    return {
      id: row.id,
      tenant_id: row.tenantId,
      name: row.name,
      code: row.code,
      is_verified: row.isVerified,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  async approveBank(tx: TxClient, claims: JwtClaims, bankId: string) {
    this.assertCapability(claims, Capabilities.masterDataApprove);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const row = await tx.bank.findFirst({
      where: {
        id: bankId,
        tenantId,
        deletedAt: null
      }
    });
    if (!row) {
      throw new NotFoundException(`bank ${bankId} not found`);
    }
    const updated = await tx.bank.update({
      where: { id: bankId },
      data: {
        isVerified: true,
        reviewedAt: new Date(),
        reviewedByUserId: claims.user_id ?? null
      }
    });
    return {
      id: updated.id,
      is_verified: updated.isVerified,
      reviewed_at: updated.reviewedAt?.toISOString() ?? null
    };
  }

  async listBankBranches(
    tx: TxClient,
    claims: JwtClaims,
    query: MasterDataSearchQuery & { bank_id?: string }
  ) {
    this.assertCapability(claims, Capabilities.masterDataRead);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const rows = await tx.bankBranch.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.bank_id ? { bankId: query.bank_id } : {}),
        ...(query.search
          ? {
              OR: [
                { branchName: { contains: query.search, mode: 'insensitive' } },
                { city: { contains: query.search, mode: 'insensitive' } },
                { ifsc: { contains: query.search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      include: {
        bank: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: [{ isVerified: 'desc' }, { branchName: 'asc' }],
      take: query.limit
    });

    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      bank_id: row.bankId,
      bank_name: row.bank.name,
      client_org_id: row.clientOrgId,
      branch_name: row.branchName,
      city: row.city,
      state: row.state,
      ifsc: row.ifsc,
      is_verified: row.isVerified,
      reviewed_at: row.reviewedAt?.toISOString() ?? null,
      reviewed_by_user_id: row.reviewedByUserId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    }));
  }

  async createBankBranch(tx: TxClient, claims: JwtClaims, input: BankBranchCreate) {
    this.assertCapability(claims, Capabilities.masterDataWrite);
    const tenantId = this.resolveMasterDataTenantId(claims);

    const bank = await tx.bank.findFirst({
      where: {
        id: input.bank_id,
        tenantId,
        deletedAt: null
      }
    });
    if (!bank) {
      throw new NotFoundException(`bank ${input.bank_id} not found`);
    }

    const row = await tx.bankBranch.upsert({
      where: {
        tenantId_bankId_branchName_city: {
          tenantId,
          bankId: input.bank_id,
          branchName: input.branch_name,
          city: input.city
        }
      },
      update: {
        state: input.state ?? null,
        ifsc: input.ifsc ?? null,
        clientOrgId: input.client_org_id ?? null,
        deletedAt: null
      },
      create: {
        tenantId,
        bankId: input.bank_id,
        clientOrgId: input.client_org_id ?? null,
        branchName: input.branch_name,
        city: input.city,
        state: input.state ?? null,
        ifsc: input.ifsc ?? null,
        isVerified: claims.roles.includes('super_admin')
      }
    });

    return {
      id: row.id,
      tenant_id: row.tenantId,
      bank_id: row.bankId,
      client_org_id: row.clientOrgId,
      branch_name: row.branchName,
      city: row.city,
      state: row.state,
      ifsc: row.ifsc,
      is_verified: row.isVerified,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  async approveBankBranch(tx: TxClient, claims: JwtClaims, branchId: string) {
    this.assertCapability(claims, Capabilities.masterDataApprove);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const row = await tx.bankBranch.findFirst({
      where: {
        id: branchId,
        tenantId,
        deletedAt: null
      }
    });
    if (!row) {
      throw new NotFoundException(`bank_branch ${branchId} not found`);
    }
    const updated = await tx.bankBranch.update({
      where: { id: branchId },
      data: {
        isVerified: true,
        reviewedAt: new Date(),
        reviewedByUserId: claims.user_id ?? null
      }
    });
    return {
      id: updated.id,
      is_verified: updated.isVerified,
      reviewed_at: updated.reviewedAt?.toISOString() ?? null
    };
  }

  async listClientOrgs(tx: TxClient, claims: JwtClaims, query: MasterDataSearchQuery) {
    this.assertCapability(claims, Capabilities.masterDataRead);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const rows = await tx.clientOrg.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { city: { contains: query.search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
      take: query.limit
    });
    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      name: row.name,
      city: row.city,
      type: row.type,
      is_verified: row.isVerified,
      reviewed_at: row.reviewedAt?.toISOString() ?? null,
      reviewed_by_user_id: row.reviewedByUserId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    }));
  }

  async createClientOrg(tx: TxClient, claims: JwtClaims, input: ClientOrgCreate) {
    this.assertCapability(claims, Capabilities.masterDataWrite);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const row = await tx.clientOrg.upsert({
      where: {
        tenantId_name_city: {
          tenantId,
          name: input.name,
          city: input.city
        }
      },
      update: {
        type: input.type ?? null,
        deletedAt: null
      },
      create: {
        tenantId,
        name: input.name,
        city: input.city,
        type: input.type ?? null,
        isVerified: claims.roles.includes('super_admin')
      }
    });
    return {
      id: row.id,
      tenant_id: row.tenantId,
      name: row.name,
      city: row.city,
      type: row.type,
      is_verified: row.isVerified,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  async approveClientOrg(tx: TxClient, claims: JwtClaims, clientOrgId: string) {
    this.assertCapability(claims, Capabilities.masterDataApprove);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const row = await tx.clientOrg.findFirst({
      where: {
        id: clientOrgId,
        tenantId,
        deletedAt: null
      }
    });
    if (!row) {
      throw new NotFoundException(`client_org ${clientOrgId} not found`);
    }
    const updated = await tx.clientOrg.update({
      where: { id: clientOrgId },
      data: {
        isVerified: true,
        reviewedAt: new Date(),
        reviewedByUserId: claims.user_id ?? null
      }
    });
    return {
      id: updated.id,
      is_verified: updated.isVerified,
      reviewed_at: updated.reviewedAt?.toISOString() ?? null
    };
  }

  async listContacts(
    tx: TxClient,
    claims: JwtClaims,
    query: MasterDataSearchQuery & { client_org_id?: string }
  ) {
    this.assertCapability(claims, Capabilities.masterDataRead);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const rows = await tx.contact.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.client_org_id ? { clientOrgId: query.client_org_id } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
      take: query.limit
    });
    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      client_org_id: row.clientOrgId,
      name: row.name,
      role_label: row.roleLabel,
      phone: row.phone,
      email: row.email,
      is_primary: row.isPrimary,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    }));
  }

  async createContact(tx: TxClient, claims: JwtClaims, input: ContactCreate) {
    this.assertCapability(claims, Capabilities.masterDataWrite);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const clientOrg = await tx.clientOrg.findFirst({
      where: {
        id: input.client_org_id,
        tenantId,
        deletedAt: null
      }
    });
    if (!clientOrg) {
      throw new NotFoundException(`client_org ${input.client_org_id} not found`);
    }
    const row = await tx.contact.create({
      data: {
        tenantId,
        clientOrgId: input.client_org_id,
        name: input.name,
        roleLabel: input.role_label ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        isPrimary: input.is_primary
      }
    });
    return {
      id: row.id,
      tenant_id: row.tenantId,
      client_org_id: row.clientOrgId,
      name: row.name,
      role_label: row.roleLabel,
      phone: row.phone,
      email: row.email,
      is_primary: row.isPrimary,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  async listBranchContacts(
    tx: TxClient,
    claims: JwtClaims,
    query: MasterDataSearchQuery & { branch_id?: string }
  ) {
    this.assertCapability(claims, Capabilities.masterDataRead);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const rows = await tx.branchContact.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.branch_id ? { branchId: query.branch_id } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { email: { contains: query.search, mode: 'insensitive' } },
                { phone: { contains: query.search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      orderBy: [{ createdAt: 'desc' }],
      take: query.limit
    });

    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      branch_id: row.branchId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      role: row.role,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    }));
  }

  async createBranchContact(tx: TxClient, claims: JwtClaims, input: BranchContactCreate) {
    this.assertCapability(claims, Capabilities.masterDataWrite);
    const tenantId = this.resolveMasterDataTenantId(claims);

    const branch = await tx.bankBranch.findFirst({
      where: {
        id: input.branch_id,
        tenantId,
        deletedAt: null
      }
    });
    if (!branch) {
      throw new NotFoundException(`branch ${input.branch_id} not found`);
    }

    const row = await tx.branchContact.create({
      data: {
        tenantId,
        branchId: input.branch_id,
        name: input.name,
        phone: input.phone ?? null,
        email: input.email ?? null,
        role: input.role ?? null
      }
    });

    return {
      id: row.id,
      tenant_id: row.tenantId,
      branch_id: row.branchId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      role: row.role,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  async listProperties(tx: TxClient, claims: JwtClaims, query: MasterDataSearchQuery) {
    this.assertCapability(claims, Capabilities.masterDataRead);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const rows = await tx.property.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { line1: { contains: query.search, mode: 'insensitive' } },
                { city: { contains: query.search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      orderBy: [{ name: 'asc' }],
      take: query.limit
    });

    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      name: row.name,
      line_1: row.line1,
      city: row.city,
      state: row.state,
      postal_code: row.postalCode,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    }));
  }

  async createProperty(tx: TxClient, claims: JwtClaims, input: PropertyCreate) {
    this.assertCapability(claims, Capabilities.masterDataWrite);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const row = await tx.property.create({
      data: {
        tenantId,
        name: input.name,
        line1: input.line_1 ?? null,
        city: input.city ?? null,
        state: input.state ?? null,
        postalCode: input.postal_code ?? null
      }
    });
    return {
      id: row.id,
      tenant_id: row.tenantId,
      name: row.name,
      line_1: row.line1,
      city: row.city,
      state: row.state,
      postal_code: row.postalCode,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  async listChannels(tx: TxClient, claims: JwtClaims, query: MasterDataSearchQuery) {
    if (claims.aud !== 'portal') {
      this.assertCapability(claims, Capabilities.masterDataRead);
    }
    const tenantId = this.resolveMasterDataTenantId(claims);
    const rows = await tx.channel.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(claims.aud === 'portal' ? { ownerUserId: claims.user_id ?? null } : {}),
        ...(query.search
          ? {
              OR: [
                { name: { contains: query.search, mode: 'insensitive' } },
                { city: { contains: query.search, mode: 'insensitive' } }
              ]
            }
          : {})
      },
      orderBy: [{ isVerified: 'desc' }, { name: 'asc' }],
      take: query.limit
    });
    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      owner_user_id: row.ownerUserId,
      name: row.name,
      channel_name: row.name,
      city: row.city,
      channel_type: this.serializeChannelType(row.channelType),
      commission_mode: this.serializeCommissionMode(row.commissionMode),
      commission_value: Number(row.commissionValue),
      is_active: row.isActive,
      is_verified: row.isVerified,
      reviewed_at: row.reviewedAt?.toISOString() ?? null,
      reviewed_by_user_id: row.reviewedByUserId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    }));
  }

  async createChannel(tx: TxClient, claims: JwtClaims, input: ChannelCreate) {
    if (claims.aud !== 'portal') {
      this.assertCapability(claims, Capabilities.masterDataWrite);
    }
    const tenantId = this.resolveMasterDataTenantId(claims);
    const ownerUserId = claims.user_id ?? null;
    const existing = await tx.channel.findFirst({
      where: {
        tenantId,
        name: input.name,
        city: input.city ?? null
      }
    });

    const row = existing
      ? await tx.channel.update({
          where: { id: existing.id },
          data: {
            ownerUserId,
            channelType: this.parseChannelType(input.channel_type),
            commissionMode: this.parseCommissionMode(input.commission_mode),
            commissionValue: new Prisma.Decimal(input.commission_value),
            isActive: input.is_active,
            deletedAt: null
          }
        })
      : await tx.channel.create({
          data: {
            tenantId,
            ownerUserId,
            name: input.name,
            city: input.city ?? null,
            channelType: this.parseChannelType(input.channel_type),
            commissionMode: this.parseCommissionMode(input.commission_mode),
            commissionValue: new Prisma.Decimal(input.commission_value),
            isActive: input.is_active,
            isVerified: claims.roles.includes('super_admin')
          }
        });
    const channelType = this.serializeChannelType(row.channelType);
    const commissionMode = this.serializeCommissionMode(row.commissionMode);
    return {
      id: row.id,
      tenant_id: row.tenantId,
      owner_user_id: row.ownerUserId,
      name: row.name,
      city: row.city,
      channel_type: channelType,
      commission_mode: commissionMode,
      commission_value: Number(row.commissionValue),
      is_active: row.isActive,
      is_verified: row.isVerified,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  async approveChannel(tx: TxClient, claims: JwtClaims, channelId: string) {
    this.assertCapability(claims, Capabilities.masterDataApprove);
    const tenantId = this.resolveMasterDataTenantId(claims);
    const row = await tx.channel.findFirst({
      where: {
        id: channelId,
        tenantId,
        deletedAt: null
      }
    });
    if (!row) {
      throw new NotFoundException(`channel ${channelId} not found`);
    }
    const updated = await tx.channel.update({
      where: { id: channelId },
      data: {
        isVerified: true,
        reviewedAt: new Date(),
        reviewedByUserId: claims.user_id ?? null
      }
    });
    return {
      id: updated.id,
      is_verified: updated.isVerified,
      reviewed_at: updated.reviewedAt?.toISOString() ?? null
    };
  }

  async listChannelRequests(
    tx: TxClient,
    claims: JwtClaims,
    query: { mine?: boolean; status?: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' }
  ) {
    const tenantId = this.resolveMasterDataTenantId(claims);
    const status = query.status ? this.parseChannelRequestStatus(query.status) : undefined;

    if (claims.aud !== 'portal') {
      this.assertCapability(claims, Capabilities.masterDataRead);
    }

    const rows = await tx.channelRequest.findMany({
      where: {
        tenantId,
        deletedAt: null,
        ...(status ? { status } : {}),
        ...(claims.aud === 'portal' || query.mine ? { requestedByUserId: claims.user_id ?? '' } : {})
      },
      include: {
        channel: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: [{ createdAt: 'desc' }]
    });

    const invoiceIds = rows
      .map((row) => row.serviceInvoiceId)
      .filter((value): value is string => Boolean(value));
    const invoices = invoiceIds.length
      ? await tx.serviceInvoice.findMany({
          where: {
            id: {
              in: invoiceIds
            }
          },
          select: {
            id: true,
            status: true,
            invoiceNumber: true,
            amountDue: true,
            totalAmount: true,
            isPaid: true
          }
        })
      : [];
    const invoiceById = new Map(invoices.map((invoice) => [invoice.id, invoice]));

    return rows.map((row) => {
      const linkedInvoice = row.serviceInvoiceId ? invoiceById.get(row.serviceInvoiceId) : null;
      return {
        id: row.id,
        tenant_id: row.tenantId,
        channel_id: row.channelId,
        channel_name: row.channel.name,
        requested_by_user_id: row.requestedByUserId,
        assignment_id: row.assignmentId,
        billing_account_id: row.billingAccountId,
        billing_reservation_id: row.billingReservationId,
        service_invoice_id: row.serviceInvoiceId,
        billing_mode_at_decision: row.billingModeAtDecision ? row.billingModeAtDecision.toUpperCase() : null,
        service_invoice_status: linkedInvoice ? linkedInvoice.status.toUpperCase() : null,
        service_invoice_number: linkedInvoice?.invoiceNumber ?? null,
        service_invoice_total_amount: linkedInvoice ? Number(linkedInvoice.totalAmount.toString()) : null,
        service_invoice_amount_due: linkedInvoice ? Number(linkedInvoice.amountDue.toString()) : null,
        service_invoice_is_paid: linkedInvoice?.isPaid ?? null,
        borrower_name: row.borrowerName,
        phone: row.phone,
        property_city: row.propertyCity,
        property_address: row.propertyAddress,
        notes: row.notes,
        status: this.serializeChannelRequestStatus(row.status),
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString()
      };
    });
  }

  async createChannelRequest(tx: TxClient, claims: JwtClaims, input: ChannelRequestCreate) {
    const tenantId = this.resolveMasterDataTenantId(claims);
    const requester = claims.user_id;
    if (!requester) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    const channel = await tx.channel.findFirst({
      where: {
        id: input.channel_id,
        tenantId,
        deletedAt: null,
        ...(claims.aud === 'portal' ? { ownerUserId: requester } : {})
      }
    });
    if (!channel) {
      throw new NotFoundException(`channel ${input.channel_id} not found`);
    }

    const row = await tx.channelRequest.create({
      data: {
        tenantId,
        channelId: channel.id,
        requestedByUserId: requester,
        borrowerName: input.borrower_name,
        phone: input.phone,
        propertyCity: input.property_city,
        propertyAddress: input.property_address,
        notes: input.notes ?? null,
        status: 'submitted'
      }
    });

    return {
      id: row.id,
      tenant_id: row.tenantId,
      channel_id: row.channelId,
      requested_by_user_id: row.requestedByUserId,
      borrower_name: row.borrowerName,
      phone: row.phone,
      property_city: row.propertyCity,
      property_address: row.propertyAddress,
      notes: row.notes,
      billing_account_id: row.billingAccountId,
      billing_reservation_id: row.billingReservationId,
      service_invoice_id: row.serviceInvoiceId,
      billing_mode_at_decision: row.billingModeAtDecision ? row.billingModeAtDecision.toUpperCase() : null,
      status: this.serializeChannelRequestStatus(row.status),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  async updateChannelRequestStatus(
    tx: TxClient,
    claims: JwtClaims,
    requestId: string,
    input: ChannelRequestUpdate
  ) {
    if (claims.aud === 'portal') {
      throw new ForbiddenException('PORTAL_REQUEST_REVIEW_FORBIDDEN');
    }
    this.assertCapability(claims, Capabilities.masterDataWrite);
    const tenantId = this.resolveMasterDataTenantId(claims);

    const row = await tx.channelRequest.findFirst({
      where: {
        id: requestId,
        tenantId,
        deletedAt: null
      }
    });
    if (!row) {
      throw new NotFoundException(`channel_request ${requestId} not found`);
    }

    const nextStatus = this.parseChannelRequestStatus(input.status);
    let assignmentId = row.assignmentId;
    let billingAccountId = row.billingAccountId;
    let billingReservationId = row.billingReservationId;
    let serviceInvoiceId = row.serviceInvoiceId;
    let billingModeAtDecision = row.billingModeAtDecision;

    if (nextStatus === 'accepted' && !assignmentId) {
      const createdAssignment = await tx.assignment.create({
        data: {
          tenantId,
          source: 'partner',
          sourceType: 'channel',
          stage: 'draft_created',
          channelId: row.channelId,
          title: `Channel Request: ${row.borrowerName}`,
          summary: row.notes ?? `Request from channel ${row.channelId}`,
          priority: 'normal',
          status: 'requested',
          createdByUserId: claims.user_id ?? row.requestedByUserId
        }
      });
      assignmentId = createdAssignment.id;

      await tx.assignmentSourceRecord.upsert({
        where: { assignmentId: createdAssignment.id },
        update: {
          sourceType: 'channel',
          sourceRefId: row.channelId,
          channelId: row.channelId,
          recordedByUserId: claims.user_id ?? null
        },
        create: {
          tenantId,
          assignmentId: createdAssignment.id,
          sourceType: 'channel',
          sourceRefId: row.channelId,
          channelId: row.channelId,
          recordedByUserId: claims.user_id ?? null
        }
      });

      await tx.assignmentStatusHistory.create({
        data: {
          tenantId,
          assignmentId: createdAssignment.id,
          fromStatus: null,
          toStatus: 'draft_created',
          changedByUserId: claims.user_id ?? null,
          note: 'assignment created'
        }
      });
      const billing = await this.billingControlService.ensureChannelAcceptanceBilling(tx, {
        tenant_id: tenantId,
        channel_request_id: row.id,
        requested_by_user_id: row.requestedByUserId,
        borrower_name: row.borrowerName,
        assignment_id: assignmentId,
        fee_paise: createdAssignment.feePaise
      });
      billingAccountId = billing.account_id;
      billingReservationId = billing.reservation_id;
      serviceInvoiceId = billing.service_invoice_id;
      billingModeAtDecision = billing.mode === 'CREDIT' ? 'credit' : 'postpaid';
    }

    if (nextStatus === 'accepted' && assignmentId) {
      const billing = await this.billingControlService.ensureChannelAcceptanceBilling(tx, {
        tenant_id: tenantId,
        channel_request_id: row.id,
        requested_by_user_id: row.requestedByUserId,
        borrower_name: row.borrowerName,
        assignment_id: assignmentId,
        fee_paise: null
      });
      billingAccountId = billing.account_id;
      billingReservationId = billing.reservation_id;
      serviceInvoiceId = billing.service_invoice_id;
      billingModeAtDecision = billing.mode === 'CREDIT' ? 'credit' : 'postpaid';
    }

    if (nextStatus === 'rejected') {
      await this.billingControlService.markChannelCancelledRelease(tx, {
        channel_request_id: row.id,
        account_id: row.billingAccountId ?? null,
        reservation_id: row.billingReservationId ?? null
      });
      billingReservationId = null;
    }

    const updated = await tx.channelRequest.update({
      where: { id: requestId },
      data: {
        status: nextStatus,
        assignmentId,
        billingAccountId,
        billingReservationId,
        serviceInvoiceId,
        billingModeAtDecision,
        notes: input.note ? `${row.notes ?? ''}${row.notes ? '\n' : ''}[review] ${input.note}` : row.notes
      }
    });

    return {
      id: updated.id,
      tenant_id: updated.tenantId,
      channel_id: updated.channelId,
      requested_by_user_id: updated.requestedByUserId,
      assignment_id: updated.assignmentId,
      billing_account_id: updated.billingAccountId,
      billing_reservation_id: updated.billingReservationId,
      service_invoice_id: updated.serviceInvoiceId,
      billing_mode_at_decision: updated.billingModeAtDecision ? updated.billingModeAtDecision.toUpperCase() : null,
      borrower_name: updated.borrowerName,
      phone: updated.phone,
      property_city: updated.propertyCity,
      property_address: updated.propertyAddress,
      notes: updated.notes,
      status: this.serializeChannelRequestStatus(updated.status),
      created_at: updated.createdAt.toISOString(),
      updated_at: updated.updatedAt.toISOString()
    };
  }

  async listEmployees(tx: TxClient, claims: JwtClaims) {
    this.assertCapability(claims, Capabilities.employeesRead);
    const tenantId = this.resolvePeopleTenantId(claims);
    const rows = await tx.employee.findMany({
      where: {
        tenantId,
        deletedAt: null
      },
      orderBy: [{ createdAt: 'desc' }]
    });

    return rows.map((row) => this.serializeEmployee(row));
  }

  async createEmployee(tx: TxClient, claims: JwtClaims, input: EmployeeCreate) {
    this.assertCapability(claims, Capabilities.employeesWrite);
    const tenantId = this.resolvePeopleTenantId(claims);

    if (input.user_id) {
      const user = await tx.user.findFirst({
        where: {
          id: input.user_id,
          deletedAt: null
        }
      });
      if (!user) {
        throw new NotFoundException(`user ${input.user_id} not found`);
      }
    }

    const created = await tx.employee.create({
      data: {
        tenantId,
        userId: input.user_id,
        name: input.name,
        phone: input.phone,
        email: input.email,
        role: input.role,
        status: input.status
      }
    });

    return this.serializeEmployee(created);
  }

  async listRoleTemplates(claims: JwtClaims) {
    this.assertCapability(claims, Capabilities.employeesRead);
    return [
      {
        key: 'admin',
        label: 'Admin',
        employee_role: 'admin',
        capabilities: Object.values(Capabilities)
      },
      {
        key: 'ops_manager',
        label: 'Ops Manager',
        employee_role: 'manager',
        capabilities: [
          Capabilities.employeesRead,
          Capabilities.attendanceRead,
          Capabilities.attendanceWrite,
          Capabilities.tasksRead,
          Capabilities.tasksWrite,
          Capabilities.notificationsRoutesRead,
          Capabilities.notificationsSend,
          Capabilities.invoicesRead
        ]
      },
      {
        key: 'finance',
        label: 'Finance',
        employee_role: 'finance',
        capabilities: [
          Capabilities.payrollRead,
          Capabilities.payrollWrite,
          Capabilities.payrollRun,
          Capabilities.invoicesRead,
          Capabilities.invoicesWrite
        ]
      },
      {
        key: 'hr',
        label: 'HR',
        employee_role: 'hr',
        capabilities: [
          Capabilities.employeesRead,
          Capabilities.employeesWrite,
          Capabilities.attendanceRead,
          Capabilities.attendanceWrite,
          Capabilities.payrollRead
        ]
      },
      {
        key: 'assistant_valuer',
        label: 'Assistant Valuer',
        employee_role: 'assistant_valuer',
        capabilities: [Capabilities.attendanceWrite]
      },
      {
        key: 'field_valuer',
        label: 'Field Valuer',
        employee_role: 'field_valuer',
        capabilities: [Capabilities.attendanceWrite, Capabilities.tasksRead]
      },
      {
        key: 'external_channel',
        label: 'External Channel',
        employee_role: 'operations',
        capabilities: []
      }
    ];
  }

  async assignEmployeeRole(tx: TxClient, claims: JwtClaims, employeeId: string, input: EmployeeRoleAssign) {
    this.assertCapability(claims, Capabilities.employeesWrite);
    const tenantId = this.resolvePeopleTenantId(claims);

    const employee = await tx.employee.findFirst({
      where: {
        id: employeeId,
        tenantId,
        deletedAt: null
      }
    });
    if (!employee) {
      throw new NotFoundException(`employee ${employeeId} not found`);
    }

    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { role: input.role }
    });

    return this.serializeEmployee(updated);
  }

  async upsertRoleContactPoint(tx: TxClient, claims: JwtClaims, input: RoleContactPointUpsert) {
    this.assertCapability(claims, Capabilities.notificationsRoutesWrite);
    const tenantId = this.resolvePeopleTenantId(claims);
    const groupKey = input.role.toUpperCase();

    const contactPoint = await tx.contactPoint.upsert({
      where: {
        tenantId_kind_value: {
          tenantId,
          kind: input.channel === 'email' ? 'email' : 'whatsapp',
          value: input.value
        }
      },
      update: {
        isPrimary: input.is_primary
      },
      create: {
        tenantId,
        kind: input.channel === 'email' ? 'email' : 'whatsapp',
        value: input.value,
        isPrimary: input.is_primary
      }
    });

    return this.createNotificationRoute(tx, claims, {
      group_key: groupKey,
      group_name: `${input.role.replaceAll('_', ' ')} contacts`,
      channel: input.channel,
      to_contact_point_id: contactPoint.id,
      is_active: input.is_active
    });
  }

  async markAttendance(
    tx: TxClient,
    claims: JwtClaims,
    requestId: string,
    kind: 'checkin' | 'checkout',
    input: AttendanceMark
  ) {
    this.assertCapability(claims, Capabilities.attendanceWrite);
    const tenantId = this.resolvePeopleTenantId(claims);

    const employee = await tx.employee.findFirst({
      where: {
        id: input.employee_id,
        tenantId,
        deletedAt: null,
        status: 'active'
      }
    });

    if (!employee) {
      throw new NotFoundException(`employee ${input.employee_id} not found`);
    }

    const existing = await tx.attendanceEvent.findFirst({
      where: {
        tenantId,
        requestId
      }
    });

    if (existing) {
      return {
        ...this.serializeAttendanceEvent(existing),
        duplicate: true
      };
    }

    const happenedAt = input.happened_at ? new Date(input.happened_at) : new Date();

    try {
      const created = await tx.attendanceEvent.create({
        data: {
          tenantId,
          employeeId: employee.id,
          kind,
          source: input.source,
          happenedAt,
          requestId,
          metaJson: (input.meta_json ?? {}) as Prisma.InputJsonObject,
          createdByUserId: claims.user_id ?? null
        }
      });

      return {
        ...this.serializeAttendanceEvent(created),
        duplicate: false
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const retry = await tx.attendanceEvent.findFirst({
          where: {
            tenantId,
            requestId
          }
        });
        if (retry) {
          return {
            ...this.serializeAttendanceEvent(retry),
            duplicate: true
          };
        }
      }
      throw error;
    }
  }

  async listPayrollPeriods(tx: TxClient, claims: JwtClaims) {
    this.assertCapability(claims, Capabilities.payrollRead);
    const tenantId = this.resolvePeopleTenantId(claims);
    const rows = await tx.payrollPeriod.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: {
            items: true
          }
        }
      },
      orderBy: [{ monthStart: 'desc' }]
    });

    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      month_start: toDateOnly(row.monthStart),
      month_end: toDateOnly(row.monthEnd),
      status: row.status,
      item_count: row._count.items,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    }));
  }

  async createPayrollPeriod(tx: TxClient, claims: JwtClaims, input: PayrollPeriodCreate) {
    this.assertCapability(claims, Capabilities.payrollWrite);
    const tenantId = this.resolvePeopleTenantId(claims);
    const monthStart = parseDateOnly(input.month_start);
    const monthEnd = parseDateOnly(input.month_end);

    if (!monthStart || !monthEnd) {
      throw new BadRequestException('month_start and month_end are required');
    }
    if (monthEnd.getTime() < monthStart.getTime()) {
      throw new BadRequestException('month_end must be on/after month_start');
    }

    const existing = await tx.payrollPeriod.findFirst({
      where: {
        tenantId,
        monthStart,
        monthEnd
      }
    });

    if (existing) {
      return {
        id: existing.id,
        tenant_id: existing.tenantId,
        month_start: toDateOnly(existing.monthStart),
        month_end: toDateOnly(existing.monthEnd),
        status: existing.status,
        created_at: existing.createdAt.toISOString(),
        updated_at: existing.updatedAt.toISOString()
      };
    }

    const created = await tx.payrollPeriod.create({
      data: {
        tenantId,
        monthStart,
        monthEnd,
        status: input.status
      }
    });

    return {
      id: created.id,
      tenant_id: created.tenantId,
      month_start: toDateOnly(created.monthStart),
      month_end: toDateOnly(created.monthEnd),
      status: created.status,
      created_at: created.createdAt.toISOString(),
      updated_at: created.updatedAt.toISOString()
    };
  }

  async runPayrollPeriod(tx: TxClient, claims: JwtClaims, payrollPeriodId: string) {
    this.assertCapability(claims, Capabilities.payrollRun);
    const tenantId = this.resolvePeopleTenantId(claims);

    const period = await tx.payrollPeriod.findFirst({
      where: {
        id: payrollPeriodId,
        tenantId
      }
    });
    if (!period) {
      throw new NotFoundException(`payroll_period ${payrollPeriodId} not found`);
    }

    const updated =
      period.status === 'draft'
        ? await tx.payrollPeriod.update({
            where: { id: period.id },
            data: { status: 'running' }
          })
        : period;

    const items = await tx.payrollItem.findMany({
      where: {
        tenantId,
        payrollPeriodId: period.id
      }
    });

    const totals = items.reduce(
      (acc, item) => {
        const amount = Number(item.amountPaise);
        if (item.kind === 'earning') {
          acc.earnings += amount;
        } else {
          acc.deductions += amount;
        }
        return acc;
      },
      { earnings: 0, deductions: 0 }
    );

    return {
      id: updated.id,
      tenant_id: updated.tenantId,
      month_start: toDateOnly(updated.monthStart),
      month_end: toDateOnly(updated.monthEnd),
      status: updated.status,
      item_count: items.length,
      total_earnings_paise: totals.earnings,
      total_deductions_paise: totals.deductions,
      net_paise: totals.earnings - totals.deductions
    };
  }

  async listPayrollItems(tx: TxClient, claims: JwtClaims, payrollPeriodId: string) {
    this.assertCapability(claims, Capabilities.payrollRead);
    const tenantId = this.resolvePeopleTenantId(claims);

    const period = await tx.payrollPeriod.findFirst({
      where: {
        id: payrollPeriodId,
        tenantId
      }
    });
    if (!period) {
      throw new NotFoundException(`payroll_period ${payrollPeriodId} not found`);
    }

    const rows = await tx.payrollItem.findMany({
      where: {
        tenantId,
        payrollPeriodId
      },
      include: {
        employee: true
      },
      orderBy: [{ createdAt: 'desc' }]
    });

    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      payroll_period_id: row.payrollPeriodId,
      employee_id: row.employeeId,
      employee_name: row.employee.name,
      kind: row.kind,
      label: row.label,
      amount_paise: Number(row.amountPaise),
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    }));
  }

  async createPayrollItem(tx: TxClient, claims: JwtClaims, payrollPeriodId: string, input: PayrollItemCreate) {
    this.assertCapability(claims, Capabilities.payrollWrite);
    const tenantId = this.resolvePeopleTenantId(claims);

    const period = await tx.payrollPeriod.findFirst({
      where: {
        id: payrollPeriodId,
        tenantId
      }
    });
    if (!period) {
      throw new NotFoundException(`payroll_period ${payrollPeriodId} not found`);
    }

    const employee = await tx.employee.findFirst({
      where: {
        id: input.employee_id,
        tenantId,
        deletedAt: null
      }
    });
    if (!employee) {
      throw new NotFoundException(`employee ${input.employee_id} not found`);
    }

    const created = await tx.payrollItem.create({
      data: {
        tenantId,
        payrollPeriodId,
        employeeId: input.employee_id,
        kind: input.kind,
        label: input.label,
        amountPaise: BigInt(input.amount_paise)
      }
    });

    return {
      id: created.id,
      tenant_id: created.tenantId,
      payroll_period_id: created.payrollPeriodId,
      employee_id: created.employeeId,
      kind: created.kind,
      label: created.label,
      amount_paise: Number(created.amountPaise),
      created_at: created.createdAt.toISOString(),
      updated_at: created.updatedAt.toISOString()
    };
  }

  async createNotificationRoute(tx: TxClient, claims: JwtClaims, input: NotificationRouteCreate) {
    this.assertCapability(claims, Capabilities.notificationsRoutesWrite);
    const tenantId = this.resolvePeopleTenantId(claims);
    const groupKey = input.group_key.trim().toUpperCase();

    const contactPoint = await tx.contactPoint.findFirst({
      where: {
        id: input.to_contact_point_id,
        tenantId
      }
    });

    if (!contactPoint) {
      throw new NotFoundException(`contact_point ${input.to_contact_point_id} not found`);
    }

    const group = await tx.notificationTargetGroup.upsert({
      where: {
        tenantId_groupKey: {
          tenantId,
          groupKey
        }
      },
      update: {
        name: input.group_name,
        isActive: input.is_active
      },
      create: {
        tenantId,
        groupKey,
        name: input.group_name,
        isActive: input.is_active
      }
    });

    const existingTarget = await tx.notificationTarget.findFirst({
      where: {
        tenantId,
        groupId: group.id,
        channel: input.channel,
        toContactPointId: input.to_contact_point_id
      }
    });

    const target = existingTarget
      ? await tx.notificationTarget.update({
          where: { id: existingTarget.id },
          data: {
            isActive: input.is_active
          }
        })
      : await tx.notificationTarget.create({
          data: {
            tenantId,
            groupId: group.id,
            channel: input.channel,
            toContactPointId: input.to_contact_point_id,
            isActive: input.is_active
          }
        });

    return {
      group: {
        id: group.id,
        tenant_id: group.tenantId,
        key: group.groupKey,
        name: group.name,
        is_active: group.isActive
      },
      target: {
        id: target.id,
        tenant_id: target.tenantId,
        group_id: target.groupId,
        channel: target.channel,
        to_contact_point_id: target.toContactPointId,
        is_active: target.isActive
      }
    };
  }

  async listNotificationRoutes(tx: TxClient, claims: JwtClaims) {
    this.assertCapability(claims, Capabilities.notificationsRoutesRead);
    const tenantId = this.resolvePeopleTenantId(claims);
    const rows = await tx.notificationTarget.findMany({
      where: {
        tenantId
      },
      include: {
        group: true,
        toContactPoint: true
      },
      orderBy: [{ createdAt: 'desc' }]
    });

    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      group: {
        id: row.group.id,
        key: row.group.groupKey,
        name: row.group.name,
        is_active: row.group.isActive
      },
      channel: row.channel,
      to_contact_point: {
        id: row.toContactPoint.id,
        kind: row.toContactPoint.kind,
        value: row.toContactPoint.value
      },
      is_active: row.isActive,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    }));
  }

  async softDeleteUser(tx: TxClient, id: string) {
    return tx.user.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async listWorkOrders(tx: TxClient) {
    return tx.workOrder.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  async createWorkOrder(tx: TxClient, input: WorkOrderCreate) {
    return tx.workOrder.create({
      data: {
        tenantId: input.tenant_id,
        portalUserId: input.portal_user_id,
        source: input.source,
        title: input.title,
        description: input.description
      }
    });
  }

  async softDeleteWorkOrder(tx: TxClient, id: string) {
    return tx.workOrder.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async getAnalyticsOverview(tx: TxClient, claims: JwtClaims): Promise<AnalyticsOverview> {
    this.assertAssignmentReadAudience(claims);
    const tenantId = this.resolveTenantIdForMutation(claims);

    const [assignmentsTotal, assignmentsOpen, tasksOpen, tasksOverdue, channelRequestsSubmitted, outboxFailed, outboxDead] =
      await Promise.all([
        tx.assignment.count({
          where: {
            tenantId,
            deletedAt: null
          }
        }),
        tx.assignment.count({
          where: {
            tenantId,
            deletedAt: null,
            stage: {
              not: 'closed'
            }
          }
        }),
        tx.task.count({
          where: {
            tenantId,
            deletedAt: null,
            status: {
              not: 'done'
            }
          }
        }),
        tx.task.count({
          where: {
            tenantId,
            deletedAt: null,
            isOverdue: true,
            status: {
              not: 'done'
            }
          }
        }),
        tx.channelRequest.count({
          where: {
            tenantId,
            deletedAt: null,
            status: 'submitted'
          }
        }),
        tx.notificationOutbox.count({
          where: {
            tenantId,
            status: 'failed'
          }
        }),
        tx.notificationOutbox.count({
          where: {
            tenantId,
            status: 'dead'
          }
        })
      ]);

    return {
      assignments_total: assignmentsTotal,
      assignments_open: assignmentsOpen,
      tasks_open: tasksOpen,
      tasks_overdue: tasksOverdue,
      channel_requests_submitted: channelRequestsSubmitted,
      outbox_failed: outboxFailed,
      outbox_dead: outboxDead
    };
  }

  async listAssignments(tx: TxClient, claims: JwtClaims, query: AssignmentListQuery = {}) {
    this.assertAssignmentReadAudience(claims);

    const where: Prisma.AssignmentWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
      ...(query.assignee_user_id
        ? {
            assignees: {
              some: {
                userId: query.assignee_user_id
              }
            }
          }
        : {}),
      ...(query.due_date ? { dueDate: parseDateOnly(query.due_date) } : {})
    };

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { summary: { contains: query.search, mode: 'insensitive' } }
      ];
    }

    const rows = await tx.assignment.findMany({
      where,
      include: {
        assignees: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        _count: {
          select: {
            tasks: true,
            messages: true,
            activities: true
          }
        },
        bank: {
          select: {
            id: true,
            name: true
          }
        },
        bankBranch: {
          select: {
            id: true,
            branchName: true
          }
        },
        clientOrg: {
          select: {
            id: true,
            name: true
          }
        },
        property: {
          select: {
            id: true,
            name: true
          }
        },
        primaryContact: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }]
    });

    return rows.map((row) => {
      const completeness = this.computeAssignmentCompleteness(row);
      return {
        id: row.id,
        tenant_id: row.tenantId,
        source: row.source,
        source_type: row.sourceType,
        source_label: row.source === 'partner' ? 'channel' : row.source,
        work_order_id: row.workOrderId,
        bank_id: row.bankId,
        bank_name: row.bank?.name ?? null,
        bank_branch_id: row.bankBranchId,
        bank_branch_name: row.bankBranch?.branchName ?? null,
        client_org_id: row.clientOrgId,
        client_org_name: row.clientOrg?.name ?? null,
        property_id: row.propertyId,
        property_name: row.property?.name ?? null,
        primary_contact_id: row.primaryContactId,
        primary_contact_name: row.primaryContact?.name ?? null,
        fee_paise: row.feePaise === null ? null : Number(row.feePaise),
        stage: row.stage,
        lifecycle_status: this.serializeLifecycleStatus(row.stage),
        title: row.title,
        summary: row.summary,
        priority: row.priority,
        status: row.status,
        due_date: toDateOnly(row.dueDate),
        due_at: row.dueAt?.toISOString() ?? null,
        created_by_user_id: row.createdByUserId,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        data_completeness: completeness,
        assignees: row.assignees.map((assignee) => ({
          user_id: assignee.userId,
          role: assignee.role,
          user_name: assignee.user.name,
          user_email: assignee.user.email
        })),
        task_count: row._count.tasks,
        message_count: row._count.messages,
        activity_count: row._count.activities
      };
    });
  }

  async createAssignment(tx: TxClient, claims: JwtClaims, input: AssignmentCreate) {
    this.assertAssignmentWriteAudience(claims);
    const tenantId = this.resolveTenantIdForMutation(claims);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    if (input.work_order_id) {
      const workOrder = await tx.workOrder.findFirst({
        where: {
          id: input.work_order_id,
          tenantId,
          deletedAt: null
        }
      });
      if (!workOrder) {
        throw new NotFoundException(`work_order ${input.work_order_id} not found`);
      }

      const existing = await tx.assignment.findFirst({
        where: {
          workOrderId: input.work_order_id,
          deletedAt: null
        }
      });
      if (existing) {
        return this.getAssignmentDetail(tx, claims, existing.id);
      }
    }

    await this.assertAssignmentMasterData(tx, tenantId, {
      bankId: input.bank_id,
      bankBranchId: input.bank_branch_id,
      clientOrgId: input.client_org_id,
      propertyId: input.property_id,
      primaryContactId: input.primary_contact_id,
      channelId: input.channel_id,
      sourceRefId: input.source_ref_id,
      sourceType: input.source_type
    });

    const source = input.source === 'partner' ? 'partner' : input.source;

    try {
      const created = await tx.assignment.create({
        data: {
          tenantId,
          source,
          sourceType: input.source_type,
          workOrderId: input.work_order_id,
          bankId: input.bank_id,
          bankBranchId: input.bank_branch_id,
          clientOrgId: input.client_org_id,
          propertyId: input.property_id,
          channelId: input.channel_id,
          primaryContactId: input.primary_contact_id,
          feePaise: input.fee_paise === undefined ? null : BigInt(input.fee_paise),
          stage: 'draft_created',
          title: input.title,
          summary: input.summary,
          priority: input.priority,
          status: input.status,
          dueAt: parseDateOnly(input.due_date),
          dueDate: parseDateOnly(input.due_date),
          createdByUserId: actorUserId
        }
      });

      await tx.assignmentSourceRecord.upsert({
        where: {
          assignmentId: created.id
        },
        update: {
          sourceType: input.source_type,
          sourceRefId: input.source_ref_id ?? null,
          bankBranchId: input.bank_branch_id ?? null,
          clientOrgId: input.client_org_id ?? null,
          channelId: input.channel_id ?? null,
          recordedByUserId: actorUserId,
          metadataJson: {
            source: input.source,
            source_ref_id: input.source_ref_id ?? null
          }
        },
        create: {
          tenantId,
          assignmentId: created.id,
          sourceType: input.source_type,
          sourceRefId: input.source_ref_id ?? null,
          bankBranchId: input.bank_branch_id ?? null,
          clientOrgId: input.client_org_id ?? null,
          channelId: input.channel_id ?? null,
          recordedByUserId: actorUserId,
          metadataJson: {
            source: input.source,
            source_ref_id: input.source_ref_id ?? null
          }
        }
      });

      await this.appendAssignmentActivity(tx, {
        tenantId,
        assignmentId: created.id,
        actorUserId,
        type: 'created',
        payload: {
          source,
          source_type: input.source_type,
          source_ref_id: input.source_ref_id ?? null,
          work_order_id: input.work_order_id ?? null
        }
      });

      await this.notificationsService.enqueueEvent(tx, {
        tenantId,
        eventType: 'assignment_created',
        templateKey: 'assignment_created',
        payload: {
          assignment_id: created.id,
          title: created.title,
          status: created.status
        },
        idempotencyKey: `assignment_created:${created.id}`,
        assignmentId: created.id
      });

      return this.getAssignmentDetail(tx, claims, created.id);
    } catch (error) {
      if (input.work_order_id && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await tx.assignment.findFirst({
          where: {
            workOrderId: input.work_order_id,
            deletedAt: null
          }
        });
        if (existing) {
          return this.getAssignmentDetail(tx, claims, existing.id);
        }
      }
      throw error;
    }
  }

  async getAssignmentDetail(tx: TxClient, claims: JwtClaims, assignmentId: string) {
    this.assertAssignmentReadAudience(claims);
    const assignment = await this.getAssignmentOrThrow(tx, assignmentId);

    const [tasks, messages, activities, links, sourceRecord, transitions, statusHistory, signals] = await Promise.all([
      tx.assignmentTask.findMany({
        where: { assignmentId: assignment.id },
        include: {
          floor: true,
          assignedToUser: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: [{ floorId: 'asc' }, { createdAt: 'asc' }]
      }),
      tx.assignmentMessage.findMany({
        where: { assignmentId: assignment.id },
        include: {
          authorUser: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: { createdAt: 'asc' }
      }),
      tx.assignmentActivity.findMany({
        where: { assignmentId: assignment.id },
        include: {
          actorUser: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      tx.documentLink.findMany({
        where: {
          tenantId: assignment.tenantId,
          assignmentId: assignment.id
        },
        include: {
          document: true
        },
        orderBy: { createdAt: 'desc' }
      }),
      tx.assignmentSourceRecord.findUnique({
        where: {
          assignmentId: assignment.id
        }
      }),
      tx.assignmentStageTransition.findMany({
        where: {
          tenantId: assignment.tenantId,
          assignmentId: assignment.id
        },
        include: {
          changedByUser: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: { changedAt: 'desc' }
      }),
      tx.assignmentStatusHistory.findMany({
        where: {
          tenantId: assignment.tenantId,
          assignmentId: assignment.id
        },
        include: {
          changedByUser: {
            select: {
              id: true,
              name: true,
              email: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      tx.assignmentSignal.findMany({
        where: {
          tenantId: assignment.tenantId,
          assignmentId: assignment.id
        },
        orderBy: { kind: 'asc' }
      })
    ]);

    const floors = await tx.assignmentFloor.findMany({
      where: { assignmentId: assignment.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
    });

    return {
      ...this.serializeAssignment(assignment),
      source_record: sourceRecord
        ? {
            id: sourceRecord.id,
            source_type: sourceRecord.sourceType,
            source_ref_id: sourceRecord.sourceRefId,
            bank_branch_id: sourceRecord.bankBranchId,
            client_org_id: sourceRecord.clientOrgId,
            channel_id: sourceRecord.channelId,
            recorded_by_user_id: sourceRecord.recordedByUserId,
            recorded_at: sourceRecord.recordedAt.toISOString(),
            metadata_json: asJsonRecord(sourceRecord.metadataJson)
          }
        : null,
      data_completeness: this.computeAssignmentCompleteness(assignment),
      assignees: assignment.assignees.map((assignee) => ({
        id: assignee.id,
        user_id: assignee.userId,
        role: assignee.role,
        created_at: assignee.createdAt.toISOString(),
        user: {
          id: assignee.user.id,
          name: assignee.user.name,
          email: assignee.user.email
        }
      })),
      floors: floors.map((floor) => ({
        id: floor.id,
        name: floor.name,
        sort_order: floor.sortOrder,
        created_at: floor.createdAt.toISOString()
      })),
      tasks: tasks.map((task) => this.serializeAssignmentTask(task)),
      messages: messages.map((message) => ({
        id: message.id,
        assignment_id: message.assignmentId,
        author_user_id: message.authorUserId,
        body: message.body,
        created_at: message.createdAt.toISOString(),
        author: {
          id: message.authorUser.id,
          name: message.authorUser.name,
          email: message.authorUser.email
        }
      })),
      activities: activities.map((activity) => ({
        id: activity.id,
        assignment_id: activity.assignmentId,
        actor_user_id: activity.actorUserId,
        type: activity.type,
        payload: asJsonRecord(activity.payload),
        created_at: activity.createdAt.toISOString(),
        actor: activity.actorUser
          ? {
              id: activity.actorUser.id,
              name: activity.actorUser.name,
              email: activity.actorUser.email
            }
          : null
      })),
      stage_transitions: transitions.map((row) => ({
        id: row.id,
        assignment_id: row.assignmentId,
        from_stage: row.fromStage,
        to_stage: row.toStage,
        reason: row.reason,
        changed_by_user_id: row.changedByUserId,
        changed_at: row.changedAt.toISOString(),
        metadata_json: asJsonRecord(row.metadataJson),
        changed_by_user: row.changedByUser
          ? {
              id: row.changedByUser.id,
              name: row.changedByUser.name,
              email: row.changedByUser.email
            }
          : null
      })),
      status_history: statusHistory.map((row) => ({
        id: row.id,
        from_status: row.fromStatus ? this.serializeLifecycleStatus(row.fromStatus as AssignmentStageValue) : null,
        to_status: this.serializeLifecycleStatus(row.toStatus as AssignmentStageValue),
        note: row.note,
        created_at: row.createdAt.toISOString(),
        changed_by_user_id: row.changedByUserId,
        changed_by_user: row.changedByUser
          ? {
              id: row.changedByUser.id,
              name: row.changedByUser.name,
              email: row.changedByUser.email
            }
          : null
      })),
      signals: signals.map((signal) => ({
        id: signal.id,
        kind: signal.kind,
        is_active: signal.isActive,
        first_seen_at: signal.firstSeenAt.toISOString(),
        last_seen_at: signal.lastSeenAt.toISOString(),
        details_json: asJsonRecord(signal.detailsJson)
      })),
      documents: links
        .filter((link) => link.document.deletedAt === null)
        .map((link) => ({
          id: link.document.id,
          purpose: link.purpose,
          linked_at: link.createdAt.toISOString(),
          metadata: this.serializeDocument(link.document),
          presign_download_endpoint: `/v1/files/${link.document.id}/presign-download`
        }))
    };
  }

  async patchAssignment(tx: TxClient, claims: JwtClaims, assignmentId: string, input: AssignmentUpdate) {
    this.assertAssignmentWriteAudience(claims);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    const existing = await this.getAssignmentOrThrow(tx, assignmentId);
    const data: Prisma.AssignmentUncheckedUpdateInput = {};

    if (input.title !== undefined) {
      data.title = input.title;
    }
    if (input.summary !== undefined) {
      data.summary = input.summary;
    }
    if (input.priority !== undefined) {
      data.priority = input.priority;
    }
    if (input.status !== undefined) {
      data.status = input.status;
    }
    if (input.bank_id !== undefined) {
      data.bankId = input.bank_id;
    }
    if (input.bank_branch_id !== undefined) {
      data.bankBranchId = input.bank_branch_id;
    }
    if (input.client_org_id !== undefined) {
      data.clientOrgId = input.client_org_id;
    }
    if (input.property_id !== undefined) {
      data.propertyId = input.property_id;
    }
    if (input.channel_id !== undefined) {
      data.channelId = input.channel_id;
    }
    if (input.source_type !== undefined) {
      data.sourceType = input.source_type;
    }
    if (input.primary_contact_id !== undefined) {
      data.primaryContactId = input.primary_contact_id;
    }
    if (input.fee_paise !== undefined) {
      data.feePaise = input.fee_paise === null ? null : BigInt(input.fee_paise);
    }
    if (input.due_at !== undefined) {
      data.dueAt = input.due_at ? new Date(input.due_at) : null;
    }
    if (input.due_date !== undefined) {
      data.dueDate = parseDateOnly(input.due_date);
    }

    await this.assertAssignmentMasterData(tx, existing.tenantId, {
      bankId: input.bank_id === undefined ? existing.bankId : input.bank_id,
      bankBranchId: input.bank_branch_id === undefined ? existing.bankBranchId : input.bank_branch_id,
      clientOrgId: input.client_org_id === undefined ? existing.clientOrgId : input.client_org_id,
      propertyId: input.property_id === undefined ? existing.propertyId : input.property_id,
      channelId: input.channel_id === undefined ? existing.channelId : input.channel_id,
      primaryContactId: input.primary_contact_id === undefined ? existing.primaryContactId : input.primary_contact_id
    });

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('NO_CHANGES');
    }

    const updated = await tx.assignment.update({
      where: { id: assignmentId },
      data
    });

    await this.appendAssignmentActivity(tx, {
      tenantId: updated.tenantId,
      assignmentId,
      actorUserId,
      type: 'status_changed',
      payload: {
        changed_fields: Object.keys(data),
        before_status: existing.status,
        after_status: updated.status,
        before_priority: existing.priority,
        after_priority: updated.priority
      }
    });

    if (
      input.status &&
      input.status !== existing.status &&
      (input.status === 'delivered' || input.status === 'cancelled')
    ) {
      const linkedRequest = await tx.channelRequest.findFirst({
        where: {
          tenantId: updated.tenantId,
          assignmentId,
          deletedAt: null
        }
      });
      if (linkedRequest?.billingAccountId) {
        if (input.status === 'delivered') {
          await this.billingControlService.markChannelDeliveredBillingSatisfied(tx, {
            tenant_id: linkedRequest.tenantId,
            channel_request_id: linkedRequest.id,
            account_id: linkedRequest.billingAccountId,
            reservation_id: linkedRequest.billingReservationId,
            service_invoice_id: linkedRequest.serviceInvoiceId
          });
        } else if (input.status === 'cancelled') {
          await this.billingControlService.markChannelCancelledRelease(tx, {
            channel_request_id: linkedRequest.id,
            account_id: linkedRequest.billingAccountId,
            reservation_id: linkedRequest.billingReservationId
          });
        }
      }
    }

    return this.getAssignmentDetail(tx, claims, assignmentId);
  }

  async transitionAssignment(
    tx: TxClient,
    claims: JwtClaims,
    assignmentId: string,
    input: AssignmentTransition,
    requestId: string
  ) {
    this.assertAssignmentReadAudience(claims);
    this.assertCapability(claims, Capabilities.assignmentsTransition);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    const assignment = await this.getAssignmentOrThrow(tx, assignmentId);
    const fromStage = assignment.stage as AssignmentStageValue;
    const toStage = input.to_stage as AssignmentStageValue;

    if (fromStage === toStage) {
      return this.getAssignmentDetail(tx, claims, assignmentId);
    }
    this.assertStageTransitionAllowed(fromStage, toStage);

    const now = new Date();
    const updated = await tx.assignment.update({
      where: { id: assignmentId },
      data: {
        stage: toStage
      }
    });

    await tx.assignmentStageTransition.create({
      data: {
        tenantId: assignment.tenantId,
        assignmentId,
        fromStage,
        toStage,
        reason: input.reason ?? null,
        changedByUserId: actorUserId,
        changedAt: now,
        metadataJson: {
          request_id: requestId
        }
      }
    });

    await tx.assignmentStatusHistory.create({
      data: {
        tenantId: assignment.tenantId,
        assignmentId,
        fromStatus: fromStage,
        toStatus: toStage,
        changedByUserId: actorUserId,
        note: input.reason ?? null
      }
    });

    await this.appendAssignmentActivity(tx, {
      tenantId: assignment.tenantId,
      assignmentId,
      actorUserId,
      type: 'stage_transitioned',
      payload: {
        from_stage: fromStage,
        to_stage: toStage,
        reason: input.reason ?? null
      }
    });

    if (toStage === 'qc_pending') {
      await this.ensureQcPendingTask(tx, assignment.tenantId, assignmentId, actorUserId);
    }

    await this.assignmentSignalsQueue.enqueueRecompute({
      assignmentId,
      tenantId: assignment.tenantId,
      stage: toStage,
      dateBucket: utcDateBucket(now),
      requestId
    });

    return this.getAssignmentDetail(tx, claims, updated.id);
  }

  async changeAssignmentStatus(
    tx: TxClient,
    claims: JwtClaims,
    assignmentId: string,
    input: AssignmentStatusChange,
    requestId: string
  ) {
    const toStage = this.parseLifecycleStatus(input.to_status);
    return this.transitionAssignment(
      tx,
      claims,
      assignmentId,
      {
        to_stage: toStage,
        reason: input.note
      },
      requestId
    );
  }

  async listAssignmentStatusHistory(tx: TxClient, claims: JwtClaims, assignmentId: string) {
    this.assertAssignmentReadAudience(claims);
    const assignment = await this.getAssignmentOrThrow(tx, assignmentId);
    const rows = await tx.assignmentStatusHistory.findMany({
      where: {
        tenantId: assignment.tenantId,
        assignmentId
      },
      include: {
        changedByUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return rows.map((row) => ({
      id: row.id,
      assignment_id: row.assignmentId,
      from_status: row.fromStatus ? this.serializeLifecycleStatus(row.fromStatus as AssignmentStageValue) : null,
      to_status: this.serializeLifecycleStatus(row.toStatus as AssignmentStageValue),
      changed_by_user_id: row.changedByUserId,
      note: row.note,
      created_at: row.createdAt.toISOString(),
      changed_by_user: row.changedByUser
        ? {
            id: row.changedByUser.id,
            name: row.changedByUser.name,
            email: row.changedByUser.email
          }
        : null
    }));
  }

  async addAssignmentAssignee(
    tx: TxClient,
    claims: JwtClaims,
    assignmentId: string,
    input: AssignmentAssigneeAdd
  ) {
    this.assertAssignmentWriteAudience(claims);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    const assignment = await this.getAssignmentOrThrow(tx, assignmentId);
    const user = await tx.user.findFirst({
      where: {
        id: input.user_id,
        deletedAt: null
      }
    });

    if (!user) {
      throw new NotFoundException(`user ${input.user_id} not found`);
    }

    const existing = await tx.assignmentAssignee.findUnique({
      where: {
        assignmentId_userId: {
          assignmentId,
          userId: input.user_id
        }
      }
    });

    if (!existing) {
      await tx.assignmentAssignee.create({
        data: {
          tenantId: assignment.tenantId,
          assignmentId,
          userId: input.user_id,
          role: input.role
        }
      });

      await this.appendAssignmentActivity(tx, {
        tenantId: assignment.tenantId,
        assignmentId,
        actorUserId,
        type: 'assignee_added',
        payload: {
          user_id: input.user_id,
          role: input.role
        }
      });
    }

    return this.getAssignmentDetail(tx, claims, assignmentId);
  }

  async removeAssignmentAssignee(tx: TxClient, claims: JwtClaims, assignmentId: string, userId: string) {
    this.assertAssignmentWriteAudience(claims);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    const assignment = await this.getAssignmentOrThrow(tx, assignmentId);
    const removed = await tx.assignmentAssignee.deleteMany({
      where: {
        tenantId: assignment.tenantId,
        assignmentId,
        userId
      }
    });

    if (removed.count === 0) {
      throw new NotFoundException(`assignee ${userId} not found`);
    }

    await this.appendAssignmentActivity(tx, {
      tenantId: assignment.tenantId,
      assignmentId,
      actorUserId,
      type: 'assignee_removed',
      payload: {
        user_id: userId
      }
    });

    return this.getAssignmentDetail(tx, claims, assignmentId);
  }

  async listAssignmentTasks(tx: TxClient, claims: JwtClaims, assignmentId: string) {
    this.assertAssignmentReadAudience(claims);
    await this.getAssignmentOrThrow(tx, assignmentId);

    const tasks = await tx.assignmentTask.findMany({
      where: { assignmentId },
      include: {
        floor: true,
        assignedToUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: [{ floorId: 'asc' }, { createdAt: 'asc' }]
    });

    return tasks.map((task) => this.serializeAssignmentTask(task));
  }

  async createAssignmentTask(
    tx: TxClient,
    claims: JwtClaims,
    assignmentId: string,
    input: AssignmentTaskCreate
  ) {
    this.assertAssignmentWriteAudience(claims);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    const assignment = await this.getAssignmentOrThrow(tx, assignmentId);

    if (input.floor_id) {
      const floor = await tx.assignmentFloor.findFirst({
        where: {
          id: input.floor_id,
          tenantId: assignment.tenantId,
          assignmentId
        }
      });
      if (!floor) {
        throw new NotFoundException(`floor ${input.floor_id} not found`);
      }
    }

    if (input.assigned_to_user_id) {
      const assignee = await tx.user.findFirst({
        where: {
          id: input.assigned_to_user_id,
          deletedAt: null
        }
      });
      if (!assignee) {
        throw new NotFoundException(`user ${input.assigned_to_user_id} not found`);
      }
    }

    const task = await tx.assignmentTask.create({
      data: {
        tenantId: assignment.tenantId,
        assignmentId,
        floorId: input.floor_id,
        title: input.title,
        status: input.status,
        assignedToUserId: input.assigned_to_user_id,
        dueDate: parseDateOnly(input.due_date)
      },
      include: {
        floor: true,
        assignedToUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    await this.appendAssignmentActivity(tx, {
      tenantId: assignment.tenantId,
      assignmentId,
      actorUserId,
      type: 'task_added',
      payload: {
        task_id: task.id,
        status: task.status
      }
    });

    return this.serializeAssignmentTask(task);
  }

  async patchAssignmentTask(
    tx: TxClient,
    claims: JwtClaims,
    assignmentId: string,
    taskId: string,
    input: AssignmentTaskUpdate
  ) {
    this.assertAssignmentWriteAudience(claims);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    const assignment = await this.getAssignmentOrThrow(tx, assignmentId);
    const existing = await tx.assignmentTask.findFirst({
      where: {
        id: taskId,
        assignmentId,
        tenantId: assignment.tenantId
      }
    });

    if (!existing) {
      throw new NotFoundException(`task ${taskId} not found`);
    }

    if (input.floor_id) {
      const floor = await tx.assignmentFloor.findFirst({
        where: {
          id: input.floor_id,
          tenantId: assignment.tenantId,
          assignmentId
        }
      });
      if (!floor) {
        throw new NotFoundException(`floor ${input.floor_id} not found`);
      }
    }

    if (input.assigned_to_user_id) {
      const assignee = await tx.user.findFirst({
        where: {
          id: input.assigned_to_user_id,
          deletedAt: null
        }
      });
      if (!assignee) {
        throw new NotFoundException(`user ${input.assigned_to_user_id} not found`);
      }
    }

    const data: Prisma.AssignmentTaskUncheckedUpdateInput = {};
    if (input.title !== undefined) {
      data.title = input.title;
    }
    if (input.status !== undefined) {
      data.status = input.status;
    }
    if (input.floor_id !== undefined) {
      data.floorId = input.floor_id;
    }
    if (input.assigned_to_user_id !== undefined) {
      data.assignedToUserId = input.assigned_to_user_id;
    }
    if (input.due_date !== undefined) {
      data.dueDate = parseDateOnly(input.due_date);
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('NO_CHANGES');
    }

    const updated = await tx.assignmentTask.update({
      where: { id: taskId },
      data,
      include: {
        floor: true,
        assignedToUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    await this.appendAssignmentActivity(tx, {
      tenantId: assignment.tenantId,
      assignmentId,
      actorUserId,
      type: updated.status === 'done' && existing.status !== 'done' ? 'task_done' : 'status_changed',
      payload: {
        task_id: taskId,
        before_status: existing.status,
        after_status: updated.status,
        changed_fields: Object.keys(data)
      }
    });

    return this.serializeAssignmentTask(updated);
  }

  async deleteAssignmentTask(tx: TxClient, claims: JwtClaims, assignmentId: string, taskId: string) {
    this.assertAssignmentWriteAudience(claims);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    const assignment = await this.getAssignmentOrThrow(tx, assignmentId);
    const existing = await tx.assignmentTask.findFirst({
      where: {
        id: taskId,
        assignmentId,
        tenantId: assignment.tenantId
      }
    });

    if (!existing) {
      throw new NotFoundException(`task ${taskId} not found`);
    }

    await tx.assignmentTask.delete({
      where: { id: taskId }
    });

    await this.appendAssignmentActivity(tx, {
      tenantId: assignment.tenantId,
      assignmentId,
      actorUserId,
      type: 'status_changed',
      payload: {
        action: 'task_removed',
        task_id: taskId
      }
    });

    return {
      id: taskId,
      deleted: true
    };
  }

  async listTasks(tx: TxClient, claims: JwtClaims, query: TaskListQuery) {
    this.assertAssignmentReadAudience(claims);
    const tenantId = this.resolveTenantIdForMutation(claims);
    const now = new Date();
    const dueSoonThreshold = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const andClauses: Prisma.TaskWhereInput[] = [];
    const where: Prisma.TaskWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.assignment_id ? { assignmentId: query.assignment_id } : {}),
      ...(query.status ? { status: this.parseTaskStatus(query.status) } : {}),
      ...(query.assigned_to_me ? { assignedToUserId: claims.user_id ?? '' } : {})
    };

    if (query.overdue) {
      andClauses.push({ dueAt: { lt: now } }, { status: { not: 'done' } });
    }

    if (query.due_soon) {
      andClauses.push({ dueAt: { gte: now, lte: dueSoonThreshold } }, { status: 'open' });
    }

    if (andClauses.length > 0) {
      where.AND = andClauses;
    }

    const rows = await tx.task.findMany({
      where,
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }]
    });

    return rows.map((row) => this.serializeTask(row));
  }

  async createTask(tx: TxClient, claims: JwtClaims, input: TaskCreate) {
    this.assertAssignmentReadAudience(claims);
    const tenantId = this.resolveTenantIdForMutation(claims);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    if (input.assignment_id) {
      const assignment = await tx.assignment.findFirst({
        where: {
          id: input.assignment_id,
          tenantId,
          deletedAt: null
        }
      });
      if (!assignment) {
        throw new NotFoundException(`assignment ${input.assignment_id} not found`);
      }
    }

    if (input.assigned_to_user_id) {
      const user = await tx.user.findFirst({
        where: {
          id: input.assigned_to_user_id,
          deletedAt: null
        }
      });
      if (!user) {
        throw new NotFoundException(`user ${input.assigned_to_user_id} not found`);
      }
    }

    const dueAt = input.due_at ? new Date(input.due_at) : null;
    const status = this.parseTaskStatus(input.status);
    const created = await tx.task.create({
      data: {
        tenantId,
        assignmentId: input.assignment_id ?? null,
        title: input.title,
        description: input.description ?? null,
        status,
        isOverdue: Boolean(dueAt && dueAt.getTime() < Date.now() && status !== 'done'),
        priority: this.parseTaskPriority(input.priority),
        dueAt,
        assignedToUserId: input.assigned_to_user_id ?? null,
        createdByUserId: actorUserId
      }
    });

    return this.serializeTask(created);
  }

  async patchTask(tx: TxClient, claims: JwtClaims, taskId: string, input: TaskUpdate) {
    this.assertAssignmentReadAudience(claims);
    const tenantId = this.resolveTenantIdForMutation(claims);
    const row = await tx.task.findFirst({
      where: {
        id: taskId,
        tenantId,
        deletedAt: null
      }
    });
    if (!row) {
      throw new NotFoundException(`task ${taskId} not found`);
    }

    const data: Prisma.TaskUncheckedUpdateInput = {};
    if (input.title !== undefined) {
      data.title = input.title;
    }
    if (input.description !== undefined) {
      data.description = input.description;
    }
    if (input.status !== undefined) {
      data.status = this.parseTaskStatus(input.status);
    }
    if (input.priority !== undefined) {
      data.priority = this.parseTaskPriority(input.priority);
    }
    if (input.due_at !== undefined) {
      data.dueAt = input.due_at ? new Date(input.due_at) : null;
    }
    if (input.assigned_to_user_id !== undefined) {
      data.assignedToUserId = input.assigned_to_user_id;
    }

    const dueAt = input.due_at !== undefined ? (input.due_at ? new Date(input.due_at) : null) : row.dueAt;
    const status = input.status !== undefined ? this.parseTaskStatus(input.status) : row.status;
    data.isOverdue = Boolean(dueAt && dueAt.getTime() < Date.now() && status !== 'done');

    const updated = await tx.task.update({
      where: { id: taskId },
      data
    });

    return this.serializeTask(updated);
  }

  async markTaskDone(tx: TxClient, claims: JwtClaims, taskId: string) {
    this.assertAssignmentReadAudience(claims);
    const tenantId = this.resolveTenantIdForMutation(claims);
    const row = await tx.task.findFirst({
      where: {
        id: taskId,
        tenantId,
        deletedAt: null
      }
    });
    if (!row) {
      throw new NotFoundException(`task ${taskId} not found`);
    }

    const updated = await tx.task.update({
      where: { id: taskId },
      data: {
        status: 'done',
        isOverdue: false
      }
    });

    return this.serializeTask(updated);
  }

  async deleteTask(tx: TxClient, claims: JwtClaims, taskId: string) {
    this.assertAssignmentReadAudience(claims);
    const tenantId = this.resolveTenantIdForMutation(claims);
    const row = await tx.task.findFirst({
      where: {
        id: taskId,
        tenantId,
        deletedAt: null
      }
    });
    if (!row) {
      throw new NotFoundException(`task ${taskId} not found`);
    }

    await tx.task.update({
      where: { id: taskId },
      data: {
        deletedAt: new Date()
      }
    });

    return {
      id: taskId,
      deleted: true
    };
  }

  async postAssignmentMessage(
    tx: TxClient,
    claims: JwtClaims,
    assignmentId: string,
    input: AssignmentMessageCreate
  ) {
    this.assertAssignmentWriteAudience(claims);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    const assignment = await this.getAssignmentOrThrow(tx, assignmentId);
    const message = await tx.assignmentMessage.create({
      data: {
        tenantId: assignment.tenantId,
        assignmentId,
        authorUserId: actorUserId,
        body: input.body
      },
      include: {
        authorUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      }
    });

    await this.appendAssignmentActivity(tx, {
      tenantId: assignment.tenantId,
      assignmentId,
      actorUserId,
      type: 'message_posted',
      payload: {
        message_id: message.id
      }
    });

    return {
      id: message.id,
      assignment_id: message.assignmentId,
      author_user_id: message.authorUserId,
      body: message.body,
      created_at: message.createdAt.toISOString(),
      author: {
        id: message.authorUser.id,
        name: message.authorUser.name,
        email: message.authorUser.email
      }
    };
  }

  async listAssignmentActivities(tx: TxClient, claims: JwtClaims, assignmentId: string) {
    this.assertAssignmentReadAudience(claims);
    await this.getAssignmentOrThrow(tx, assignmentId);

    const activities = await tx.assignmentActivity.findMany({
      where: {
        assignmentId
      },
      include: {
        actorUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return activities.map((activity) => ({
      id: activity.id,
      assignment_id: activity.assignmentId,
      actor_user_id: activity.actorUserId,
      type: activity.type,
      payload: asJsonRecord(activity.payload),
      created_at: activity.createdAt.toISOString(),
      actor: activity.actorUser
        ? {
            id: activity.actorUser.id,
            name: activity.actorUser.name,
            email: activity.actorUser.email
          }
        : null
    }));
  }

  async attachDocumentToAssignment(
    tx: TxClient,
    claims: JwtClaims,
    assignmentId: string,
    input: AssignmentAttachDocument
  ) {
    this.assertAssignmentWriteAudience(claims);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    const assignment = await this.getAssignmentOrThrow(tx, assignmentId);
    const document = await tx.document.findFirst({
      where: {
        id: input.document_id,
        tenantId: assignment.tenantId,
        deletedAt: null,
        status: 'uploaded'
      }
    });

    if (!document) {
      throw new NotFoundException(`document ${input.document_id} not found`);
    }

    let link = await tx.documentLink.findFirst({
      where: {
        tenantId: assignment.tenantId,
        documentId: input.document_id,
        assignmentId,
        purpose: input.purpose,
        workOrderId: null,
        reportRequestId: null
      }
    });

    if (!link) {
      link = await tx.documentLink.create({
        data: {
          tenantId: assignment.tenantId,
          documentId: input.document_id,
          assignmentId,
          purpose: input.purpose
        }
      });

      await this.appendAssignmentActivity(tx, {
        tenantId: assignment.tenantId,
        assignmentId,
        actorUserId,
        type: 'document_attached',
        payload: {
          document_id: input.document_id,
          purpose: input.purpose
        }
      });
    }

    return {
      link_id: link.id,
      assignment_id: assignmentId,
      document_id: input.document_id,
      purpose: link.purpose,
      created_at: link.createdAt.toISOString()
    };
  }

  async softDeleteAssignment(tx: TxClient, claims: JwtClaims, id: string) {
    this.assertAssignmentWriteAudience(claims);
    const actorUserId = claims.user_id;
    if (!actorUserId) {
      throw new ForbiddenException('USER_REQUIRED');
    }

    const assignment = await this.getAssignmentOrThrow(tx, id);
    const deleted = await tx.assignment.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'cancelled' }
    });

    await this.appendAssignmentActivity(tx, {
      tenantId: assignment.tenantId,
      assignmentId: id,
      actorUserId,
      type: 'status_changed',
      payload: {
        action: 'soft_deleted',
        before_status: assignment.status,
        after_status: 'cancelled'
      }
    });

    return deleted;
  }

  async listReportRequests(tx: TxClient) {
    return tx.reportRequest.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  async createReportRequest(tx: TxClient, input: ReportRequestCreate) {
    return tx.reportRequest.create({
      data: {
        tenantId: input.tenant_id,
        assignmentId: input.assignment_id,
        workOrderId: input.work_order_id,
        templateVersionId: input.template_version_id,
        title: input.title
      }
    });
  }

  async softDeleteReportRequest(tx: TxClient, id: string) {
    return tx.reportRequest.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async listReportJobs(tx: TxClient) {
    return tx.reportJob.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  async getBillingMe(tx: TxClient, claims: JwtClaims) {
    this.assertCapability(claims, Capabilities.invoicesRead);
    if (claims.aud === 'portal') {
      throw new ForbiddenException('PORTAL_BILLING_FORBIDDEN');
    }

    const tenantId = this.resolveTenantIdForMutation(claims);
    return this.billingService.getBillingMe(tx, tenantId, new Date());
  }

  async listBillingInvoices(tx: TxClient, claims: JwtClaims) {
    this.assertCapability(claims, Capabilities.invoicesRead);
    if (claims.aud === 'portal') {
      throw new ForbiddenException('PORTAL_BILLING_FORBIDDEN');
    }

    const tenantId = this.resolveTenantIdForMutation(claims);
    return this.billingService.listInvoices(tx, tenantId);
  }

  async getBillingInvoice(tx: TxClient, claims: JwtClaims, invoiceId: string) {
    this.assertCapability(claims, Capabilities.invoicesRead);
    if (claims.aud === 'portal') {
      throw new ForbiddenException('PORTAL_BILLING_FORBIDDEN');
    }

    const tenantId = this.resolveTenantIdForMutation(claims);
    return this.billingService.getInvoice(tx, tenantId, invoiceId);
  }

  async markBillingInvoicePaid(tx: TxClient, claims: JwtClaims, invoiceId: string, input: BillingInvoiceMarkPaid) {
    const canWriteInvoices =
      claims.capabilities.includes(Capabilities.invoicesWrite) || claims.capabilities.includes('billing:write');
    if (claims.aud !== 'studio' || (!canWriteInvoices && !claims.roles.includes('super_admin'))) {
      throw new ForbiddenException('BILLING_WRITE_FORBIDDEN');
    }

    const tenantId = this.resolveTenantIdForMutation(claims);
    const invoice = await this.billingService.markInvoicePaid(tx, tenantId, invoiceId, {
      amount_paise: input.amount_paise,
      reference: input.reference,
      notes: input.notes,
      actor_user_id: claims.user_id
    });

    await this.notificationsService.enqueueEvent(tx, {
      tenantId,
      eventType: 'invoice_paid',
      templateKey: 'invoice_paid',
      payload: {
        invoice_id: invoice.id,
        total_paise: invoice.total_paise,
        paid_at: invoice.paid_at
      },
      idempotencyKey: `invoice_paid:${invoice.id}`,
      invoiceId: invoice.id
    });

    return invoice;
  }

  async queueDraft(tx: TxClient, reportRequestId: string, actorUserId?: string | null): Promise<QueueResult> {
    const reportRequest = await tx.reportRequest.findFirst({
      where: { id: reportRequestId, deletedAt: null }
    });

    if (!reportRequest) {
      throw new NotFoundException(`report_request ${reportRequestId} not found`);
    }

    const existingReservation = await tx.creditsLedger.findFirst({
      where: {
        reportRequestId,
        status: 'reserved',
        deletedAt: null
      }
    });

    const existingJob = await tx.reportJob.findFirst({
      where: {
        reportRequestId,
        deletedAt: null
      },
      orderBy: { createdAt: 'desc' }
    });

    const reservation = existingReservation
      ? existingReservation
      : await tx.creditsLedger.create({
          data: {
            tenantId: reportRequest.tenantId,
            reportRequestId,
            delta: -1,
            status: 'reserved',
            idempotencyKey: `reserve:${reportRequestId}`
          }
        });

    const reportJob = existingJob
      ? existingJob
      : await tx.reportJob.create({
          data: {
            tenantId: reportRequest.tenantId,
            reportRequestId,
            status: 'pending',
            queuedAt: new Date()
          }
        });

    if (!reservation.reportJobId) {
      await tx.creditsLedger.update({
        where: { id: reservation.id },
        data: { reportJobId: reportJob.id }
      });
    }

    await tx.reportRequest.update({
      where: { id: reportRequestId },
      data: { status: 'queued' }
    });

    if (reportRequest.assignmentId) {
      await this.appendAssignmentActivity(tx, {
        tenantId: reportRequest.tenantId,
        assignmentId: reportRequest.assignmentId,
        actorUserId: actorUserId ?? null,
        type: 'report_queued',
        payload: {
          report_request_id: reportRequestId,
          report_job_id: reportJob.id
        }
      });
    }

    return {
      reportRequestId,
      reportJobId: reportJob.id,
      tenantId: reportRequest.tenantId,
      alreadyQueued: Boolean(existingReservation && existingJob)
    };
  }

  async finalize(tx: TxClient, reportRequestId: string, actorUserId?: string | null) {
    const reportRequest = await tx.reportRequest.findFirst({
      where: { id: reportRequestId, deletedAt: null }
    });

    if (!reportRequest) {
      throw new NotFoundException(`report_request ${reportRequestId} not found`);
    }

    const consumed = await tx.creditsLedger.findFirst({
      where: {
        reportRequestId,
        status: 'consumed',
        deletedAt: null
      }
    });

    if (!consumed) {
      const reserved = await tx.creditsLedger.findFirst({
        where: {
          reportRequestId,
          status: 'reserved',
          deletedAt: null
        },
        orderBy: { createdAt: 'desc' }
      });

      if (reserved) {
        await tx.creditsLedger.update({
          where: { id: reserved.id },
          data: {
            status: 'consumed',
            idempotencyKey: `consume:${reportRequestId}`
          }
        });
      } else {
        await tx.creditsLedger.create({
          data: {
            tenantId: reportRequest.tenantId,
            reportRequestId,
            delta: -1,
            status: 'consumed',
            idempotencyKey: `consume:${reportRequestId}`
          }
        });
      }
    }

    const billing = await this.billingService.addUsageLineForFinalize(tx, {
      tenantId: reportRequest.tenantId,
      reportRequestId,
      assignmentId: reportRequest.assignmentId ?? null,
      now: new Date()
    });

    await this.notificationsService.enqueueEvent(tx, {
      tenantId: reportRequest.tenantId,
      eventType: 'invoice_created',
      templateKey: 'invoice_created',
      payload: {
        invoice_id: billing.invoice.id,
        report_request_id: reportRequestId,
        amount_paise: Number(billing.invoiceLine.amountPaise)
      },
      idempotencyKey: `invoice_created:${billing.invoice.id}`,
      invoiceId: billing.invoice.id,
      reportRequestId
    });

    const updated = await tx.reportRequest.update({
      where: { id: reportRequestId },
      data: {
        status: 'finalized'
      }
    });

    if (reportRequest.assignmentId && billing.createdInvoiceLine) {
      await this.appendAssignmentActivity(tx, {
        tenantId: reportRequest.tenantId,
        assignmentId: reportRequest.assignmentId,
        actorUserId: actorUserId ?? null,
        type: 'report_finalized',
        payload: {
          report_request_id: reportRequestId,
          invoice_id: billing.invoice.id,
          amount_paise: Number(billing.invoiceLine.amountPaise)
        }
      });
    }

    return updated;
  }

  async releaseReservation(tx: TxClient, reportRequestId: string, reason: string) {
    const reserved = await tx.creditsLedger.findFirst({
      where: {
        reportRequestId,
        status: 'reserved',
        deletedAt: null
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!reserved) {
      return null;
    }

    return tx.creditsLedger.update({
      where: { id: reserved.id },
      data: {
        status: 'released',
        idempotencyKey: `release:${reportRequestId}:${reason}`
      }
    });
  }

  async presignUpload(tx: TxClient, claims: JwtClaims, input: FilePresignUploadRequest) {
    const tenantId = this.resolveTenantIdForMutation(claims);
    await this.assertLinkTargets(tx, claims, tenantId, {
      workOrderId: input.work_order_id,
      assignmentId: input.assignment_id,
      reportRequestId: input.report_request_id,
      employeeId: input.employee_id ?? input.captured_by_employee_id
    });

    const storageKey = buildStorageKey(tenantId, 'documents', input.filename);
    const pendingContext: PendingUploadContext = {
      purpose: input.purpose,
      ...(input.work_order_id ? { work_order_id: input.work_order_id } : {}),
      ...(input.assignment_id ? { assignment_id: input.assignment_id } : {}),
      ...(input.report_request_id ? { report_request_id: input.report_request_id } : {}),
      ...(input.employee_id ? { employee_id: input.employee_id } : {})
    };

    const metadataJson: Prisma.InputJsonObject = {
      [PENDING_UPLOAD_CONTEXT_KEY]: pendingContext as unknown as Prisma.InputJsonValue,
      ...(input.remarks ? { remarks: input.remarks } : {}),
      ...(input.taken_on_site !== undefined ? { taken_on_site: input.taken_on_site } : {})
    };

    const document = await tx.document.create({
      data: {
        tenantId,
        ownerUserId: claims.user_id ?? null,
        source: input.source ?? this.sourceForAudience(claims),
        classification: input.classification,
        sensitivity: input.sensitivity,
        capturedAt: input.captured_at ? new Date(input.captured_at) : null,
        capturedByEmployeeId: input.captured_by_employee_id ?? null,
        storageKey,
        originalFilename: input.filename,
        contentType: input.content_type,
        sizeBytes: BigInt(input.size_bytes),
        sha256: input.sha256,
        status: 'pending',
        metadataJson
      }
    });

    const upload = await this.storageProvider.presignUpload({
      key: storageKey,
      contentType: input.content_type,
      contentLength: input.size_bytes,
      checksum: input.sha256
    });

    return {
      document_id: document.id,
      storage_key: storageKey,
      upload
    };
  }

  async confirmUpload(tx: TxClient, claims: JwtClaims, input: FileConfirmUploadRequest) {
    const document = await tx.document.findFirst({
      where: {
        id: input.document_id,
        deletedAt: null
      }
    });

    if (!document) {
      throw new NotFoundException(`document ${input.document_id} not found`);
    }

    const metadata = asJsonRecord(document.metadataJson);
    const pending = metadata[PENDING_UPLOAD_CONTEXT_KEY];
    const pendingContext = isRecord(pending) ? pending : {};

    const workOrderId =
      typeof pendingContext.work_order_id === 'string' ? pendingContext.work_order_id : undefined;
    const assignmentId =
      typeof pendingContext.assignment_id === 'string' ? pendingContext.assignment_id : undefined;
    const reportRequestId =
      typeof pendingContext.report_request_id === 'string' ? pendingContext.report_request_id : undefined;
    const employeeId = typeof pendingContext.employee_id === 'string' ? pendingContext.employee_id : undefined;
    const purpose =
      pendingContext.purpose === 'evidence' ||
      pendingContext.purpose === 'reference' ||
      pendingContext.purpose === 'photo' ||
      pendingContext.purpose === 'annexure'
        ? pendingContext.purpose
        : 'other';

    if (workOrderId || assignmentId || reportRequestId || employeeId) {
      await this.assertLinkTargets(tx, claims, document.tenantId, {
        workOrderId,
        assignmentId,
        reportRequestId,
        employeeId
      });

      const existingLink = await tx.documentLink.findFirst({
        where: {
          tenantId: document.tenantId,
          documentId: document.id,
          workOrderId: workOrderId ?? null,
          assignmentId: assignmentId ?? null,
          reportRequestId: reportRequestId ?? null,
          employeeId: employeeId ?? null,
          purpose
        }
      });

      if (!existingLink) {
        await tx.documentLink.create({
          data: {
            tenantId: document.tenantId,
            documentId: document.id,
            workOrderId,
            assignmentId,
            reportRequestId,
            employeeId,
            purpose
          }
        });
      }
    }

    const cleanedMetadata = { ...metadata };
    delete cleanedMetadata[PENDING_UPLOAD_CONTEXT_KEY];

    const updated = await tx.document.update({
      where: { id: document.id },
      data: {
        status: 'uploaded',
        metadataJson: cleanedMetadata as Prisma.InputJsonObject
      }
    });

    return this.serializeDocument(updated);
  }

  async presignDownload(tx: TxClient, claims: JwtClaims, documentId: string) {
    const document = await tx.document.findFirst({
      where: {
        id: documentId,
        deletedAt: null,
        status: 'uploaded'
      },
      include: {
        documentLinks: {
          where: {
            assignmentId: {
              not: null
            }
          }
        }
      }
    });

    if (!document) {
      throw new NotFoundException(`document ${documentId} not found`);
    }

    if (claims.aud === 'portal' && document.documentLinks.length > 0) {
      const assignmentIds = document.documentLinks
        .map((link) => link.assignmentId)
        .filter((value): value is string => Boolean(value));
      for (const assignmentId of assignmentIds) {
        const billingSatisfied = await this.billingControlService.isAssignmentBillingSatisfied(
          tx,
          document.tenantId,
          assignmentId
        );
        if (!billingSatisfied) {
          throw new ForbiddenException('DELIVERABLE_LOCKED_UNTIL_BILLING_SATISFIED');
        }
      }
    }

    return this.storageProvider.presignDownload({
      key: document.storageKey,
      expiresIn: 900
    });
  }

  async patchDocumentMetadata(tx: TxClient, documentId: string, input: DocumentMetadataPatch) {
    const document = await tx.document.findFirst({
      where: {
        id: documentId,
        deletedAt: null
      }
    });

    if (!document) {
      throw new NotFoundException(`document ${documentId} not found`);
    }

    const existing = asJsonRecord(document.metadataJson);
    const merged = {
      ...existing,
      ...input.metadata_json
    } as Prisma.InputJsonObject;

    const updated = await tx.document.update({
      where: { id: documentId },
      data: {
        metadataJson: merged
      }
    });

    return this.serializeDocument(updated);
  }

  async upsertDocumentTags(tx: TxClient, documentId: string, input: DocumentTagsUpsert) {
    const document = await tx.document.findFirst({
      where: {
        id: documentId,
        deletedAt: null
      }
    });

    if (!document) {
      throw new NotFoundException(`document ${documentId} not found`);
    }

    for (const tag of input.tags) {
      const key = await tx.documentTagKey.upsert({
        where: {
          tenantId_key: {
            tenantId: document.tenantId,
            key: tag.key
          }
        },
        update: {},
        create: {
          tenantId: document.tenantId,
          key: tag.key
        }
      });

      const value = tag.value
        ? await tx.documentTagValue.upsert({
            where: {
              tenantId_keyId_value: {
                tenantId: document.tenantId,
                keyId: key.id,
                value: tag.value
              }
            },
            update: {},
            create: {
              tenantId: document.tenantId,
              keyId: key.id,
              value: tag.value
            }
          })
        : null;

      const existingMap = await tx.documentTagMap.findFirst({
        where: {
          tenantId: document.tenantId,
          documentId,
          keyId: key.id,
          valueId: value?.id ?? null
        }
      });

      if (!existingMap) {
        await tx.documentTagMap.create({
          data: {
            tenantId: document.tenantId,
            documentId,
            keyId: key.id,
            valueId: value?.id ?? null
          }
        });
      }
    }

    const tags = await tx.documentTagMap.findMany({
      where: { documentId, tenantId: document.tenantId },
      include: {
        key: true,
        value: true
      },
      orderBy: { createdAt: 'asc' }
    });

    return {
      document_id: documentId,
      tags: tags.map((tag) => ({
        key: tag.key.key,
        value: tag.value?.value ?? null
      }))
    };
  }

  async listDocuments(tx: TxClient, query: DocumentListQuery) {
    const where: Prisma.DocumentWhereInput = {
      deletedAt: null
    };

    if (query.filename) {
      where.originalFilename = {
        contains: query.filename,
        mode: 'insensitive'
      };
    }

    if (query.source) {
      where.source = query.source;
    }
    if (query.classification) {
      where.classification = query.classification;
    }
    if (query.sensitivity) {
      where.sensitivity = query.sensitivity;
    }

    if (query.purpose || query.work_order_id || query.assignment_id || query.report_request_id || query.employee_id) {
      where.documentLinks = {
        some: {
          ...(query.purpose ? { purpose: query.purpose } : {}),
          ...(query.work_order_id ? { workOrderId: query.work_order_id } : {}),
          ...(query.assignment_id ? { assignmentId: query.assignment_id } : {}),
          ...(query.report_request_id ? { reportRequestId: query.report_request_id } : {}),
          ...(query.employee_id ? { employeeId: query.employee_id } : {})
        }
      };
    }

    if (query.tag_key || query.tag_value) {
      where.documentTagMap = {
        some: {
          ...(query.tag_key ? { key: { key: query.tag_key } } : {}),
          ...(query.tag_value ? { value: { value: query.tag_value } } : {})
        }
      };
    }

    const rows = await tx.document.findMany({
      where,
      include: {
        documentLinks: true,
        documentTagMap: {
          include: {
            key: true,
            value: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return rows.map((row) => ({
      ...this.serializeDocument(row),
      links: row.documentLinks.map((link) => ({
        id: link.id,
        purpose: link.purpose,
        work_order_id: link.workOrderId,
        assignment_id: link.assignmentId,
        report_request_id: link.reportRequestId,
        employee_id: link.employeeId
      })),
      tags: row.documentTagMap.map((tag) => ({
        key: tag.key.key,
        value: tag.value?.value ?? null
      })),
      presign_download_endpoint: `/v1/files/${row.id}/presign-download`
    }));
  }

  async getDataBundle(tx: TxClient, reportRequestId: string) {
    const reportRequest = await tx.reportRequest.findFirst({
      where: {
        id: reportRequestId,
        deletedAt: null
      },
      include: {
        reportInput: {
          include: {
            schema: true
          }
        }
      }
    });

    if (!reportRequest) {
      throw new NotFoundException(`report_request ${reportRequestId} not found`);
    }

    const linkPredicates: Prisma.DocumentLinkWhereInput[] = [{ reportRequestId }];
    if (reportRequest.assignmentId) {
      linkPredicates.push({ assignmentId: reportRequest.assignmentId });
    }
    if (reportRequest.workOrderId) {
      linkPredicates.push({ workOrderId: reportRequest.workOrderId });
    }

    const links = await tx.documentLink.findMany({
      where: {
        tenantId: reportRequest.tenantId,
        OR: linkPredicates
      },
      include: {
        document: true
      },
      orderBy: { createdAt: 'asc' }
    });

    return {
      report_request_id: reportRequest.id,
      status: reportRequest.status,
      schema: reportRequest.reportInput?.schema
        ? {
            name: reportRequest.reportInput.schema.name,
            version: reportRequest.reportInput.schema.version
          }
        : null,
      payload: isRecord(reportRequest.reportInput?.payload) ? reportRequest.reportInput?.payload : {},
      documents: links
        .filter((row) => row.document.deletedAt === null)
        .map((row) => ({
          ...this.serializeDocument(row.document),
          purpose: row.purpose,
          linked_by: {
            work_order_id: row.workOrderId,
            assignment_id: row.assignmentId,
            report_request_id: row.reportRequestId,
            employee_id: row.employeeId
          },
          presign_download_endpoint: `/v1/files/${row.documentId}/presign-download`
        }))
    };
  }

  async patchDataBundle(tx: TxClient, reportRequestId: string, input: ReportDataBundlePatch) {
    const reportRequest = await tx.reportRequest.findFirst({
      where: { id: reportRequestId, deletedAt: null },
      include: {
        reportInput: {
          include: {
            schema: true
          }
        }
      }
    });

    if (!reportRequest) {
      throw new NotFoundException(`report_request ${reportRequestId} not found`);
    }

    const currentSchemaVersion = reportRequest.reportInput?.schema?.version ?? null;
    if (input.expected_schema_version !== undefined && input.expected_schema_version !== currentSchemaVersion) {
      throw new ConflictException('SCHEMA_VERSION_MISMATCH');
    }

    let schemaId = reportRequest.reportInput?.schemaId ?? null;
    if (input.schema_name || input.schema_version) {
      if (!input.schema_name || !input.schema_version) {
        throw new BadRequestException('schema_name and schema_version must be provided together');
      }

      let schema = await tx.inputSchema.findUnique({
        where: {
          name_version: {
            name: input.schema_name,
            version: input.schema_version
          }
        }
      });

      if (!schema) {
        schema = await tx.inputSchema.create({
          data: {
            name: input.schema_name,
            version: input.schema_version
          }
        });
      }

      schemaId = schema.id;
    }

    const existingPayload = isRecord(reportRequest.reportInput?.payload) ? reportRequest.reportInput?.payload : {};
    const mergedPayload = {
      ...existingPayload,
      ...input.payload_merge
    } as Prisma.InputJsonObject;

    await tx.reportInput.upsert({
      where: {
        reportRequestId
      },
      update: {
        schemaId,
        payload: mergedPayload
      },
      create: {
        tenantId: reportRequest.tenantId,
        reportRequestId,
        schemaId,
        payload: mergedPayload
      }
    });

    return this.getDataBundle(tx, reportRequestId);
  }

  private assertCapability(claims: JwtClaims, capability: string): void {
    if (claims.roles.includes('super_admin') || claims.capabilities.includes('*')) {
      return;
    }
    if (!claims.capabilities.includes(capability)) {
      throw new ForbiddenException(`MISSING_CAPABILITY:${capability}`);
    }
  }

  private resolvePeopleTenantId(claims: JwtClaims): string {
    if (claims.aud === 'portal') {
      throw new ForbiddenException('PORTAL_PEOPLE_FORBIDDEN');
    }

    const tenantId = this.resolveTenantIdForMutation(claims);
    if (!this.launchMode.multiTenantEnabled && tenantId !== this.launchMode.internalTenantId) {
      throw new ForbiddenException('TENANT_NOT_ENABLED');
    }
    return tenantId;
  }

  private resolveMasterDataTenantId(claims: JwtClaims): string {
    if (claims.aud === 'portal') {
      return this.launchMode.externalTenantId;
    }

    const tenantId = this.resolveTenantIdForMutation(claims);
    if (!this.launchMode.multiTenantEnabled && tenantId !== this.launchMode.internalTenantId) {
      throw new ForbiddenException('TENANT_NOT_ENABLED');
    }
    return tenantId;
  }

  private assertStageTransitionAllowed(fromStage: AssignmentStageValue, toStage: AssignmentStageValue): void {
    const allowed = ASSIGNMENT_ALLOWED_TRANSITIONS[fromStage] ?? [];
    if (!allowed.includes(toStage)) {
      throw new BadRequestException(`ILLEGAL_STAGE_TRANSITION:${fromStage}->${toStage}`);
    }
  }

  private async ensureQcPendingTask(
    tx: TxClient,
    tenantId: string,
    assignmentId: string,
    actorUserId: string
  ): Promise<void> {
    const existingOpen = await tx.task.findFirst({
      where: {
        tenantId,
        assignmentId,
        deletedAt: null,
        title: 'QC review',
        status: {
          not: 'done'
        }
      },
      select: { id: true }
    });
    if (existingOpen) {
      return;
    }

    const opsAssignee = await tx.membership.findFirst({
      where: {
        tenantId,
        role: {
          name: 'ops_manager'
        }
      },
      select: {
        userId: true
      }
    });

    const dueAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await tx.task.create({
      data: {
        tenantId,
        assignmentId,
        title: 'QC review',
        description: 'Validate assignment data and mark QC outcome.',
        status: 'open',
        priority: 'high',
        dueAt,
        assignedToUserId: opsAssignee?.userId ?? null,
        createdByUserId: actorUserId
      }
    });
  }

  private async assertAssignmentMasterData(
    tx: TxClient,
    tenantId: string,
    input: {
      bankId?: string | null;
      bankBranchId?: string | null;
      clientOrgId?: string | null;
      propertyId?: string | null;
      primaryContactId?: string | null;
      channelId?: string | null;
      sourceRefId?: string | null;
      sourceType?: 'bank' | 'direct' | 'channel';
    }
  ): Promise<void> {
    if (input.bankId) {
      const row = await tx.bank.findFirst({
        where: {
          id: input.bankId,
          tenantId,
          deletedAt: null
        },
        select: { id: true }
      });
      if (!row) {
        throw new NotFoundException(`bank ${input.bankId} not found`);
      }
    }

    if (input.bankBranchId) {
      const row = await tx.bankBranch.findFirst({
        where: {
          id: input.bankBranchId,
          tenantId,
          deletedAt: null
        },
        select: { id: true, bankId: true, clientOrgId: true }
      });
      if (!row) {
        throw new NotFoundException(`bank_branch ${input.bankBranchId} not found`);
      }
      if (input.bankId && row.bankId !== input.bankId) {
        throw new BadRequestException('bank_branch does not belong to bank');
      }
      if (input.clientOrgId && row.clientOrgId && row.clientOrgId !== input.clientOrgId) {
        throw new BadRequestException('bank_branch does not belong to client_org');
      }
    }

    if (input.clientOrgId) {
      const row = await tx.clientOrg.findFirst({
        where: {
          id: input.clientOrgId,
          tenantId,
          deletedAt: null
        },
        select: { id: true }
      });
      if (!row) {
        throw new NotFoundException(`client_org ${input.clientOrgId} not found`);
      }
    }

    if (input.propertyId) {
      const row = await tx.property.findFirst({
        where: {
          id: input.propertyId,
          tenantId,
          deletedAt: null
        },
        select: { id: true }
      });
      if (!row) {
        throw new NotFoundException(`property ${input.propertyId} not found`);
      }
    }

    if (input.primaryContactId) {
      const row = await tx.contact.findFirst({
        where: {
          id: input.primaryContactId,
          tenantId,
          deletedAt: null
        },
        select: { id: true, clientOrgId: true }
      });
      if (!row) {
        throw new NotFoundException(`contact ${input.primaryContactId} not found`);
      }
      if (input.clientOrgId && row.clientOrgId !== input.clientOrgId) {
        throw new BadRequestException('contact does not belong to client_org');
      }
    }

    if (input.channelId) {
      const row = await tx.channel.findFirst({
        where: {
          id: input.channelId,
          tenantId,
          deletedAt: null
        },
        select: { id: true }
      });
      if (!row) {
        throw new NotFoundException(`channel ${input.channelId} not found`);
      }
    }

    if (input.sourceRefId) {
      if (input.sourceType === 'bank') {
        const row = await tx.bankBranch.findFirst({
          where: {
            id: input.sourceRefId,
            tenantId,
            deletedAt: null
          },
          select: { id: true }
        });
        if (!row) {
          throw new NotFoundException(`source_ref bank_branch ${input.sourceRefId} not found`);
        }
      } else if (input.sourceType === 'channel') {
        const row = await tx.channel.findFirst({
          where: {
            id: input.sourceRefId,
            tenantId,
            deletedAt: null
          },
          select: { id: true }
        });
        if (!row) {
          throw new NotFoundException(`source_ref channel ${input.sourceRefId} not found`);
        }
      }
    }
  }

  private computeAssignmentCompleteness(assignment: {
    bankId?: string | null;
    bankBranchId?: string | null;
    propertyId?: string | null;
    feePaise?: bigint | null;
    dueDate?: Date | null;
    primaryContactId?: string | null;
  }) {
    const checks: Array<{ ok: boolean; key: string }> = [
      { ok: Boolean(assignment.bankId), key: 'bank' },
      { ok: Boolean(assignment.bankBranchId), key: 'branch' },
      { ok: Boolean(assignment.propertyId), key: 'property' },
      { ok: assignment.feePaise !== null && assignment.feePaise !== undefined, key: 'fee' },
      { ok: Boolean(assignment.dueDate), key: 'due_date' },
      { ok: Boolean(assignment.primaryContactId), key: 'contact' }
    ];

    const complete = checks.filter((item) => item.ok).length;
    const score = Math.round((complete / checks.length) * 100);
    const missing = checks.filter((item) => !item.ok).map((item) => item.key);

    return {
      score,
      missing
    };
  }

  private parseChannelType(value: 'AGENT' | 'ADVOCATE' | 'BUILDER' | 'OTHER'): 'agent' | 'advocate' | 'builder' | 'other' {
    return value.toLowerCase() as 'agent' | 'advocate' | 'builder' | 'other';
  }

  private serializeChannelType(value: string): 'AGENT' | 'ADVOCATE' | 'BUILDER' | 'OTHER' {
    return value.toUpperCase() as 'AGENT' | 'ADVOCATE' | 'BUILDER' | 'OTHER';
  }

  private parseCommissionMode(value: 'PERCENT' | 'FLAT'): 'percent' | 'flat' {
    return value.toLowerCase() as 'percent' | 'flat';
  }

  private serializeCommissionMode(value: string): 'PERCENT' | 'FLAT' {
    return value.toUpperCase() as 'PERCENT' | 'FLAT';
  }

  private parseTaskStatus(value: 'OPEN' | 'DONE' | 'BLOCKED'): 'open' | 'done' | 'blocked' {
    return value.toLowerCase() as 'open' | 'done' | 'blocked';
  }

  private serializeTaskStatus(value: string): 'OPEN' | 'DONE' | 'BLOCKED' {
    return value.toUpperCase() as 'OPEN' | 'DONE' | 'BLOCKED';
  }

  private parseTaskPriority(value: 'LOW' | 'MEDIUM' | 'HIGH'): 'low' | 'medium' | 'high' {
    return value.toLowerCase() as 'low' | 'medium' | 'high';
  }

  private serializeTaskPriority(value: string): 'LOW' | 'MEDIUM' | 'HIGH' {
    return value.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH';
  }

  private parseChannelRequestStatus(
    value: 'SUBMITTED' | 'ACCEPTED' | 'REJECTED'
  ): 'submitted' | 'accepted' | 'rejected' {
    return value.toLowerCase() as 'submitted' | 'accepted' | 'rejected';
  }

  private serializeChannelRequestStatus(value: string): 'SUBMITTED' | 'ACCEPTED' | 'REJECTED' {
    return value.toUpperCase() as 'SUBMITTED' | 'ACCEPTED' | 'REJECTED';
  }

  private parseLifecycleStatus(value: AssignmentStatusChange['to_status']): AssignmentStageValue {
    return LIFECYCLE_STATUS_TO_STAGE[value];
  }

  private serializeLifecycleStatus(stage: AssignmentStageValue): AssignmentStatusChange['to_status'] {
    const match = Object.entries(LIFECYCLE_STATUS_TO_STAGE).find(([, mapped]) => mapped === stage)?.[0];
    return (match ?? 'DRAFT') as AssignmentStatusChange['to_status'];
  }

  private serializeTask(row: {
    id: string;
    tenantId: string;
    assignmentId: string | null;
    title: string;
    description: string | null;
    status: string;
    isOverdue: boolean;
    priority: string;
    dueAt: Date | null;
    assignedToUserId: string | null;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      tenant_id: row.tenantId,
      assignment_id: row.assignmentId,
      title: row.title,
      description: row.description,
      status: this.serializeTaskStatus(row.status),
      priority: this.serializeTaskPriority(row.priority),
      due_at: row.dueAt?.toISOString() ?? null,
      assigned_to_user_id: row.assignedToUserId,
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      overdue: row.isOverdue
    };
  }

  private serializeEmployee(row: {
    id: string;
    tenantId: string;
    userId: string | null;
    name: string;
    phone: string | null;
    email: string | null;
    role: string;
    status: string;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      tenant_id: row.tenantId,
      user_id: row.userId,
      name: row.name,
      phone: row.phone,
      email: row.email,
      role: row.role,
      status: row.status,
      deleted_at: row.deletedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private serializeAttendanceEvent(row: {
    id: string;
    tenantId: string;
    employeeId: string;
    kind: string;
    source: string;
    happenedAt: Date;
    metaJson: Prisma.JsonValue;
    requestId: string;
    createdByUserId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      tenant_id: row.tenantId,
      employee_id: row.employeeId,
      kind: row.kind,
      source: row.source,
      happened_at: row.happenedAt.toISOString(),
      meta_json: asJsonRecord(row.metaJson),
      request_id: row.requestId,
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString()
    };
  }

  private assertAssignmentReadAudience(claims: JwtClaims): void {
    if (claims.aud === 'portal') {
      throw new ForbiddenException('PORTAL_ASSIGNMENTS_FORBIDDEN');
    }
  }

  private assertAssignmentWriteAudience(claims: JwtClaims): void {
    if (claims.aud !== 'web') {
      throw new ForbiddenException('ASSIGNMENT_WRITE_FORBIDDEN');
    }
  }

  private async getAssignmentOrThrow(tx: TxClient, assignmentId: string) {
    const assignment = await tx.assignment.findFirst({
      where: {
        id: assignmentId,
        deletedAt: null
      },
      include: {
        assignees: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true
              }
            }
          },
          orderBy: { createdAt: 'asc' }
        },
        bank: {
          select: {
            id: true,
            name: true
          }
        },
        bankBranch: {
          select: {
            id: true,
            branchName: true,
            city: true
          }
        },
        clientOrg: {
          select: {
            id: true,
            name: true
          }
        },
        property: {
          select: {
            id: true,
            name: true
          }
        },
        primaryContact: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true
          }
        }
      }
    });

    if (!assignment) {
      throw new NotFoundException(`assignment ${assignmentId} not found`);
    }

    return assignment;
  }

  private async appendAssignmentActivity(
    tx: TxClient,
    input: {
      tenantId: string;
      assignmentId: string;
      actorUserId: string | null;
      type:
        | 'created'
        | 'status_changed'
        | 'stage_transitioned'
        | 'assignee_added'
        | 'assignee_removed'
        | 'task_added'
        | 'task_done'
        | 'message_posted'
        | 'document_attached'
        | 'report_queued'
        | 'report_finalized';
      payload?: Record<string, unknown>;
    }
  ) {
    await tx.assignmentActivity.create({
      data: {
        tenantId: input.tenantId,
        assignmentId: input.assignmentId,
        actorUserId: input.actorUserId,
        type: input.type,
        payload: (input.payload ?? {}) as unknown as Prisma.InputJsonObject
      }
    });
  }

  private serializeAssignment(assignment: {
    id: string;
    tenantId: string;
    source: string;
    sourceType: string;
    stage: string;
    workOrderId: string | null;
    bankId: string | null;
    bankBranchId: string | null;
    clientOrgId: string | null;
    propertyId: string | null;
    primaryContactId: string | null;
    feePaise: bigint | null;
    title: string;
    summary: string | null;
    priority: string;
    status: string;
    dueDate: Date | null;
    dueAt: Date | null;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
    bank?: {
      id: string;
      name: string;
    } | null;
    bankBranch?: {
      id: string;
      branchName: string;
      city: string;
    } | null;
    clientOrg?: {
      id: string;
      name: string;
    } | null;
    property?: {
      id: string;
      name: string;
    } | null;
    primaryContact?: {
      id: string;
      name: string;
      phone: string | null;
      email: string | null;
    } | null;
  }) {
    return {
      id: assignment.id,
      tenant_id: assignment.tenantId,
      source: assignment.source,
      source_type: assignment.sourceType,
      source_label: assignment.source === 'partner' ? 'channel' : assignment.source,
      stage: assignment.stage,
      lifecycle_status: this.serializeLifecycleStatus(assignment.stage as AssignmentStageValue),
      work_order_id: assignment.workOrderId,
      bank_id: assignment.bankId,
      bank_name: assignment.bank?.name ?? null,
      bank_branch_id: assignment.bankBranchId,
      bank_branch_name: assignment.bankBranch?.branchName ?? null,
      client_org_id: assignment.clientOrgId,
      client_org_name: assignment.clientOrg?.name ?? null,
      property_id: assignment.propertyId,
      property_name: assignment.property?.name ?? null,
      primary_contact_id: assignment.primaryContactId,
      primary_contact_name: assignment.primaryContact?.name ?? null,
      fee_paise: assignment.feePaise === null ? null : Number(assignment.feePaise),
      title: assignment.title,
      summary: assignment.summary,
      priority: assignment.priority,
      status: assignment.status,
      due_at: assignment.dueAt?.toISOString() ?? null,
      due_date: toDateOnly(assignment.dueDate),
      created_by_user_id: assignment.createdByUserId,
      created_at: assignment.createdAt.toISOString(),
      updated_at: assignment.updatedAt.toISOString(),
      data_completeness: this.computeAssignmentCompleteness(assignment)
    };
  }

  private serializeAssignmentTask(task: {
    id: string;
    assignmentId: string;
    floorId: string | null;
    title: string;
    status: string;
    assignedToUserId: string | null;
    dueDate: Date | null;
    createdAt: Date;
    updatedAt: Date;
    floor?: {
      id: string;
      name: string;
      sortOrder: number;
    } | null;
    assignedToUser?: {
      id: string;
      name: string;
      email: string;
    } | null;
  }) {
    return {
      id: task.id,
      assignment_id: task.assignmentId,
      floor_id: task.floorId,
      floor: task.floor
        ? {
            id: task.floor.id,
            name: task.floor.name,
            sort_order: task.floor.sortOrder
          }
        : null,
      title: task.title,
      status: task.status,
      assigned_to_user_id: task.assignedToUserId,
      assigned_to_user: task.assignedToUser
        ? {
            id: task.assignedToUser.id,
            name: task.assignedToUser.name,
            email: task.assignedToUser.email
          }
        : null,
      due_date: toDateOnly(task.dueDate),
      created_at: task.createdAt.toISOString(),
      updated_at: task.updatedAt.toISOString()
    };
  }

  private sourceForAudience(
    claims: JwtClaims
  ): 'portal' | 'tenant' | 'internal' | 'mobile_camera' | 'mobile_gallery' | 'desktop_upload' | 'email_ingest' | 'portal_upload' {
    if (claims.aud === 'portal') {
      return 'portal';
    }
    if (claims.aud === 'studio') {
      return 'internal';
    }
    return 'tenant';
  }

  private resolveTenantIdForMutation(claims: JwtClaims): string {
    if (claims.aud === 'portal') {
      if (!claims.user_id) {
        throw new ForbiddenException('PORTAL_USER_REQUIRED');
      }
      return this.launchMode.externalTenantId;
    }

    if (claims.aud === 'web') {
      if (!this.launchMode.multiTenantEnabled) {
        if (claims.tenant_id !== this.launchMode.internalTenantId) {
          throw new ForbiddenException('TENANT_NOT_ENABLED');
        }
        return this.launchMode.internalTenantId;
      }
      if (!claims.tenant_id) {
        throw new ForbiddenException('TENANT_REQUIRED');
      }
      return claims.tenant_id;
    }

    if (!claims.tenant_id) {
      throw new BadRequestException('tenant_id is required for this operation');
    }
    return claims.tenant_id;
  }

  private async assertLinkTargets(
    tx: TxClient,
    claims: JwtClaims,
    tenantId: string,
    input: {
      workOrderId?: string;
      assignmentId?: string;
      reportRequestId?: string;
      employeeId?: string;
    }
  ): Promise<void> {
    let workOrder: { id: string; portalUserId: string | null } | null = null;
    if (input.workOrderId) {
      workOrder = await tx.workOrder.findFirst({
        where: {
          id: input.workOrderId,
          tenantId,
          deletedAt: null
        },
        select: {
          id: true,
          portalUserId: true
        }
      });

      if (!workOrder) {
        throw new NotFoundException(`work_order ${input.workOrderId} not found`);
      }
    }

    let assignment: { id: string; workOrderId: string | null } | null = null;
    if (input.assignmentId) {
      assignment = await tx.assignment.findFirst({
        where: {
          id: input.assignmentId,
          tenantId,
          deletedAt: null
        },
        select: {
          id: true,
          workOrderId: true
        }
      });

      if (!assignment) {
        throw new NotFoundException(`assignment ${input.assignmentId} not found`);
      }
    }

    let reportRequest: { id: string; assignmentId: string | null; workOrderId: string | null } | null = null;
    if (input.reportRequestId) {
      reportRequest = await tx.reportRequest.findFirst({
        where: {
          id: input.reportRequestId,
          tenantId,
          deletedAt: null
        },
        select: {
          id: true,
          assignmentId: true,
          workOrderId: true
        }
      });

      if (!reportRequest) {
        throw new NotFoundException(`report_request ${input.reportRequestId} not found`);
      }
    }

    if (input.employeeId) {
      const employee = await tx.employee.findFirst({
        where: {
          id: input.employeeId,
          tenantId,
          deletedAt: null
        },
        select: { id: true }
      });
      if (!employee) {
        throw new NotFoundException(`employee ${input.employeeId} not found`);
      }
    }

    if (input.workOrderId && assignment && assignment.workOrderId !== input.workOrderId) {
      throw new BadRequestException('assignment does not belong to work_order');
    }

    if (input.workOrderId && reportRequest?.workOrderId && reportRequest.workOrderId !== input.workOrderId) {
      throw new BadRequestException('report_request does not belong to work_order');
    }

    if (input.assignmentId && reportRequest?.assignmentId && reportRequest.assignmentId !== input.assignmentId) {
      throw new BadRequestException('report_request does not belong to assignment');
    }

    if (claims.aud === 'portal') {
      if (input.employeeId) {
        throw new ForbiddenException('PORTAL_LINK_FORBIDDEN');
      }
      const expectedPortalUserId = claims.user_id;
      if (!expectedPortalUserId) {
        throw new ForbiddenException('PORTAL_USER_REQUIRED');
      }

      const workOrderForOwnership = workOrder
        ? workOrder
        : reportRequest?.workOrderId
          ? await tx.workOrder.findFirst({
              where: {
                id: reportRequest.workOrderId,
                tenantId,
                deletedAt: null
              },
              select: { id: true, portalUserId: true }
            })
          : null;

      if (workOrderForOwnership && workOrderForOwnership.portalUserId !== expectedPortalUserId) {
        throw new ForbiddenException('PORTAL_LINK_FORBIDDEN');
      }
    }
  }

  private serializeDocument(document: {
    id: string;
    tenantId: string;
    ownerUserId: string | null;
    source: string;
    classification: string;
    sensitivity: string;
    capturedAt: Date | null;
    capturedByEmployeeId: string | null;
    storageKey: string;
    originalFilename: string | null;
    contentType: string | null;
    sizeBytes: bigint | null;
    sha256: string | null;
    status: string;
    metadataJson: Prisma.JsonValue;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: document.id,
      tenant_id: document.tenantId,
      owner_user_id: document.ownerUserId,
      source: document.source,
      classification: document.classification,
      sensitivity: document.sensitivity,
      captured_at: document.capturedAt?.toISOString() ?? null,
      captured_by_employee_id: document.capturedByEmployeeId,
      storage_key: document.storageKey,
      original_filename: document.originalFilename,
      content_type: document.contentType,
      size_bytes: document.sizeBytes === null ? null : Number(document.sizeBytes),
      sha256: document.sha256,
      status: document.status,
      metadata_json: asJsonRecord(document.metadataJson),
      created_at: document.createdAt.toISOString(),
      updated_at: document.updatedAt.toISOString()
    };
  }
}
