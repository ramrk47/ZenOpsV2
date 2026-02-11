import { Injectable, NotFoundException } from '@nestjs/common';
import type { TxClient } from '@zenops/db';
import type {
  AssignmentCreate,
  ReportRequestCreate,
  TenantCreate,
  UserCreate,
  WorkOrderCreate
} from '@zenops/contracts';

export interface QueueResult {
  reportRequestId: string;
  reportJobId: string;
  tenantId: string;
  alreadyQueued: boolean;
}

@Injectable()
export class DomainService {
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

  async listAssignments(tx: TxClient) {
    return tx.assignment.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  }

  async createAssignment(tx: TxClient, input: AssignmentCreate) {
    return tx.assignment.create({
      data: {
        tenantId: input.tenant_id,
        workOrderId: input.work_order_id,
        sourceWorkOrderId: input.source_work_order_id,
        assigneeUserId: input.assignee_user_id
      }
    });
  }

  async softDeleteAssignment(tx: TxClient, id: string) {
    return tx.assignment.update({ where: { id }, data: { deletedAt: new Date() } });
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

  async queueDraft(tx: TxClient, reportRequestId: string): Promise<QueueResult> {
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

    return {
      reportRequestId,
      reportJobId: reportJob.id,
      tenantId: reportRequest.tenantId,
      alreadyQueued: Boolean(existingReservation && existingJob)
    };
  }

  async finalize(tx: TxClient, reportRequestId: string) {
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
}
