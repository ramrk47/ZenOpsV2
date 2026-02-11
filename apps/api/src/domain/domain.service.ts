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
  AssignmentAssigneeAdd,
  AssignmentAttachDocument,
  AssignmentCreate,
  AssignmentListQuery,
  AssignmentMessageCreate,
  AssignmentTaskCreate,
  AssignmentTaskUpdate,
  AssignmentUpdate,
  DocumentListQuery,
  DocumentMetadataPatch,
  DocumentTagsUpsert,
  FileConfirmUploadRequest,
  FilePresignUploadRequest,
  ReportDataBundlePatch,
  ReportRequestCreate,
  TenantCreate,
  UserCreate,
  WorkOrderCreate
} from '@zenops/contracts';
import { Prisma, type TxClient } from '@zenops/db';
import { buildStorageKey, type StorageProvider } from '@zenops/storage';
import type { LaunchModeConfig } from '../common/launch-mode.js';

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

@Injectable()
export class DomainService {
  constructor(
    @Inject('STORAGE_PROVIDER') private readonly storageProvider: StorageProvider,
    @Inject('LAUNCH_MODE_CONFIG') private readonly launchMode: LaunchModeConfig
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

  async listAssignments(tx: TxClient, claims: JwtClaims, query: AssignmentListQuery = {}) {
    this.assertAssignmentReadAudience(claims);

    const where: Prisma.AssignmentWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
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
        }
      },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }]
    });

    return rows.map((row) => ({
      id: row.id,
      tenant_id: row.tenantId,
      source: row.source,
      work_order_id: row.workOrderId,
      title: row.title,
      summary: row.summary,
      priority: row.priority,
      status: row.status,
      due_date: toDateOnly(row.dueDate),
      created_by_user_id: row.createdByUserId,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      assignees: row.assignees.map((assignee) => ({
        user_id: assignee.userId,
        role: assignee.role,
        user_name: assignee.user.name,
        user_email: assignee.user.email
      })),
      task_count: row._count.tasks,
      message_count: row._count.messages,
      activity_count: row._count.activities
    }));
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

    try {
      const created = await tx.assignment.create({
        data: {
          tenantId,
          source: input.source,
          workOrderId: input.work_order_id,
          title: input.title,
          summary: input.summary,
          priority: input.priority,
          status: input.status,
          dueDate: parseDateOnly(input.due_date),
          createdByUserId: actorUserId
        }
      });

      await this.appendAssignmentActivity(tx, {
        tenantId,
        assignmentId: created.id,
        actorUserId,
        type: 'created',
        payload: {
          source: input.source,
          work_order_id: input.work_order_id ?? null
        }
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

    const [tasks, messages, activities, links] = await Promise.all([
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
      })
    ]);

    const floors = await tx.assignmentFloor.findMany({
      where: { assignmentId: assignment.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
    });

    return {
      ...this.serializeAssignment(assignment),
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
    const data: Prisma.AssignmentUpdateInput = {};

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
    if (input.due_date !== undefined) {
      data.dueDate = parseDateOnly(input.due_date);
    }

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

    return this.getAssignmentDetail(tx, claims, assignmentId);
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

    const updated = await tx.reportRequest.update({
      where: { id: reportRequestId },
      data: {
        status: 'finalized'
      }
    });

    if (reportRequest.assignmentId) {
      await this.appendAssignmentActivity(tx, {
        tenantId: reportRequest.tenantId,
        assignmentId: reportRequest.assignmentId,
        actorUserId: actorUserId ?? null,
        type: 'report_finalized',
        payload: {
          report_request_id: reportRequestId
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
      reportRequestId: input.report_request_id
    });

    const storageKey = buildStorageKey(tenantId, 'documents', input.filename);
    const pendingContext: PendingUploadContext = {
      purpose: input.purpose,
      ...(input.work_order_id ? { work_order_id: input.work_order_id } : {}),
      ...(input.assignment_id ? { assignment_id: input.assignment_id } : {}),
      ...(input.report_request_id ? { report_request_id: input.report_request_id } : {})
    };

    const metadataJson: Prisma.InputJsonObject = {
      [PENDING_UPLOAD_CONTEXT_KEY]: pendingContext as unknown as Prisma.InputJsonValue
    };

    const document = await tx.document.create({
      data: {
        tenantId,
        ownerUserId: claims.user_id ?? null,
        source: this.sourceForAudience(claims),
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
    const purpose =
      pendingContext.purpose === 'evidence' ||
      pendingContext.purpose === 'reference' ||
      pendingContext.purpose === 'photo' ||
      pendingContext.purpose === 'annexure'
        ? pendingContext.purpose
        : 'other';

    if (workOrderId || assignmentId || reportRequestId) {
      await this.assertLinkTargets(tx, claims, document.tenantId, {
        workOrderId,
        assignmentId,
        reportRequestId
      });

      const existingLink = await tx.documentLink.findFirst({
        where: {
          tenantId: document.tenantId,
          documentId: document.id,
          workOrderId: workOrderId ?? null,
          assignmentId: assignmentId ?? null,
          reportRequestId: reportRequestId ?? null,
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

  async presignDownload(tx: TxClient, documentId: string) {
    const document = await tx.document.findFirst({
      where: {
        id: documentId,
        deletedAt: null,
        status: 'uploaded'
      }
    });

    if (!document) {
      throw new NotFoundException(`document ${documentId} not found`);
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

    if (query.purpose || query.work_order_id || query.assignment_id || query.report_request_id) {
      where.documentLinks = {
        some: {
          ...(query.purpose ? { purpose: query.purpose } : {}),
          ...(query.work_order_id ? { workOrderId: query.work_order_id } : {}),
          ...(query.assignment_id ? { assignmentId: query.assignment_id } : {}),
          ...(query.report_request_id ? { reportRequestId: query.report_request_id } : {})
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
        report_request_id: link.reportRequestId
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
            report_request_id: row.reportRequestId
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
    workOrderId: string | null;
    title: string;
    summary: string | null;
    priority: string;
    status: string;
    dueDate: Date | null;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: assignment.id,
      tenant_id: assignment.tenantId,
      source: assignment.source,
      work_order_id: assignment.workOrderId,
      title: assignment.title,
      summary: assignment.summary,
      priority: assignment.priority,
      status: assignment.status,
      due_date: toDateOnly(assignment.dueDate),
      created_by_user_id: assignment.createdByUserId,
      created_at: assignment.createdAt.toISOString(),
      updated_at: assignment.updatedAt.toISOString()
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

  private sourceForAudience(claims: JwtClaims): 'portal' | 'tenant' | 'internal' {
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
