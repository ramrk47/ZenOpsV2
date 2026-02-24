# Frontend/Backend Contract Report

- Total call sites scanned: **222**
- Mismatches: **0**

## Call Site Map

| File | Method | Frontend Path | Backend OpenAPI Path | Response Shape | Status |
|---|---|---|---|---|---|
| `frontend/src/api/activity.js:4` | `GET` | `/api/activity` | `/api/activity` | `array<ActivityRead>` | OK |
| `frontend/src/api/analytics.js:4` | `GET` | `/api/analytics/source-intel` | `/api/analytics/source-intel` | `AnalyticsResponse` | OK |
| `frontend/src/api/analytics.js:9` | `GET` | `/api/analytics/banks` | `/api/analytics/banks` | `AnalyticsBankResponse` | OK |
| `frontend/src/api/analytics.js:14` | `GET` | `/api/analytics/service-lines` | `/api/analytics/service-lines` | `AnalyticsSegmentResponse` | OK |
| `frontend/src/api/analytics.js:19` | `GET` | `/api/analytics/case-types` | `/api/analytics/case-types` | `AnalyticsSegmentResponse` | OK |
| `frontend/src/api/analytics.js:24` | `GET` | `/api/analytics/settings` | `/api/analytics/settings` | `AnalyticsSettingsResponse` | OK |
| `frontend/src/api/analytics.js:29` | `PATCH` | `/api/analytics/settings` | `/api/analytics/settings` | `AnalyticsSettingsRead` | OK |
| `frontend/src/api/analytics.js:34` | `GET` | `/api/analytics/signals` | `/api/analytics/signals` | `array<AnalyticsSignal>` | OK |
| `frontend/src/api/analytics.js:39` | `GET` | `/api/analytics/follow-ups` | `/api/analytics/follow-ups` | `array<FollowUpTaskRead>` | OK |
| `frontend/src/api/analytics.js:44` | `PATCH` | `/api/analytics/follow-ups/{param}` | `/api/analytics/follow-ups/{task_id}` | `FollowUpTaskRead` | OK |
| `frontend/src/api/analytics.js:49` | `GET` | `/api/analytics/relationship-logs` | `/api/analytics/relationship-logs` | `array<RelationshipLogRead>` | OK |
| `frontend/src/api/analytics.js:54` | `POST` | `/api/analytics/relationship-logs` | `/api/analytics/relationship-logs` | `RelationshipLogRead` | OK |
| `frontend/src/api/analytics.js:59` | `GET` | `/api/analytics/forecast-v2` | `/api/analytics/forecast-v2` | `ForecastV2Response` | OK |
| `frontend/src/api/analytics.js:64` | `GET` | `/api/analytics/weekly-digest` | `/api/analytics/weekly-digest` | `WeeklyDigestResponse` | OK |
| `frontend/src/api/analytics.js:69` | `POST` | `/api/analytics/visit-reminders` | `/api/analytics/visit-reminders` | `VisitReminderResponse` | OK |
| `frontend/src/api/analytics.js:74` | `GET` | `/api/analytics/export.pdf` | `/api/analytics/export.pdf` | `Successful Response` | OK |
| `frontend/src/api/analytics.js:79` | `GET` | `/api/analytics/partners/summary` | `/api/analytics/partners/summary` | `array<PartnerSummaryRead>` | OK |
| `frontend/src/api/analytics.js:84` | `GET` | `/api/analytics/partners/{param}/bank-branch` | `/api/analytics/partners/{partner_id}/bank-branch` | `array<PartnerBankBreakdown>` | OK |
| `frontend/src/api/approvals.js:4` | `GET` | `/api/approvals/inbox` | `/api/approvals/inbox` | `array<ApprovalRead>` | OK |
| `frontend/src/api/approvals.js:11` | `GET` | `/api/approvals/mine` | `/api/approvals/mine` | `array<ApprovalRead>` | OK |
| `frontend/src/api/approvals.js:18` | `POST` | `/api/approvals/request` | `/api/approvals/request` | `ApprovalRead` | OK |
| `frontend/src/api/approvals.js:23` | `POST` | `/api/approvals/{param}/approve` | `/api/approvals/{approval_id}/approve` | `ApprovalRead` | OK |
| `frontend/src/api/approvals.js:28` | `POST` | `/api/approvals/{param}/reject` | `/api/approvals/{approval_id}/reject` | `ApprovalRead` | OK |
| `frontend/src/api/approvals.js:33` | `GET` | `/api/approvals/templates` | `/api/approvals/templates` | `array<ApprovalTemplate>` | OK |
| `frontend/src/api/approvals.js:38` | `GET` | `/api/approvals/inbox-count` | `/api/approvals/inbox-count` | `object` | OK |
| `frontend/src/api/assignments.js:4` | `GET` | `/api/assignments/with-due` | `/api/assignments/with-due` | `array<AssignmentWithDue>` | OK |
| `frontend/src/api/assignments.js:9` | `GET` | `/api/assignments/{param}/detail` | `/api/assignments/{assignment_id}/detail` | `AssignmentDetail` | OK |
| `frontend/src/api/assignments.js:14` | `GET` | `/api/assignments/{param}/documents/checklist` | `/api/assignments/{assignment_id}/documents/checklist` | `DocumentChecklist` | OK |
| `frontend/src/api/assignments.js:19` | `POST` | `/api/assignments/{param}/documents/remind` | `/api/assignments/{assignment_id}/documents/remind` | `object` | OK |
| `frontend/src/api/assignments.js:24` | `POST` | `/api/assignments` | `/api/assignments` | `AssignmentRead` | OK |
| `frontend/src/api/assignments.js:29` | `PATCH` | `/api/assignments/{param}` | `/api/assignments/{assignment_id}` | `AssignmentRead` | OK |
| `frontend/src/api/assignments.js:34` | `DELETE` | `/api/assignments/{param}` | `/api/assignments/{assignment_id}` | `schema` | OK |
| `frontend/src/api/assignments.js:39` | `GET` | `/api/assignments/summary` | `/api/assignments/summary` | `AssignmentSummary` | OK |
| `frontend/src/api/assignments.js:44` | `GET` | `/api/assignments/workload` | `/api/assignments/workload` | `array<UserWorkload>` | OK |
| `frontend/src/api/attendance.js:8` | `GET` | `/api/attendance` | `/api/attendance` | `array<WorkSessionRead>` | OK |
| `frontend/src/api/backups.js:4` | `GET` | `/api/backups` | `/api/backups` | `BackupListResponse` | OK |
| `frontend/src/api/backups.js:9` | `POST` | `/api/backups/trigger` | `/api/backups/trigger` | `object` | OK |
| `frontend/src/api/calendar.js:4` | `GET` | `/api/calendar/events` | `/api/calendar/events` | `array<CalendarEventRead>` | OK |
| `frontend/src/api/calendar.js:9` | `POST` | `/api/calendar/events` | `/api/calendar/events` | `CalendarEventRead` | OK |
| `frontend/src/api/calendar.js:14` | `PATCH` | `/api/calendar/events/{param}` | `/api/calendar/events/{event_id}` | `CalendarEventRead` | OK |
| `frontend/src/api/calendar.js:19` | `DELETE` | `/api/calendar/events/{param}` | `/api/calendar/events/{event_id}` | `Successful Response` | OK |
| `frontend/src/api/dashboard.js:4` | `GET` | `/api/dashboard/overview` | `/api/dashboard/overview` | `DashboardOverview` | OK |
| `frontend/src/api/documentTemplates.js:4` | `GET` | `/api/master/document-templates` | `/api/master/document-templates` | `DocumentTemplateList` | OK |
| `frontend/src/api/documentTemplates.js:9` | `GET` | `/api/master/document-templates/{param}` | `/api/master/document-templates/{template_id}` | `DocumentTemplateRead` | OK |
| `frontend/src/api/documentTemplates.js:14` | `POST` | `/api/master/document-templates` | `/api/master/document-templates` | `DocumentTemplateRead` | OK |
| `frontend/src/api/documentTemplates.js:21` | `PATCH` | `/api/master/document-templates/{param}` | `/api/master/document-templates/{template_id}` | `DocumentTemplateRead` | OK |
| `frontend/src/api/documentTemplates.js:26` | `DELETE` | `/api/master/document-templates/{param}` | `/api/master/document-templates/{template_id}` | `Successful Response` | OK |
| `frontend/src/api/documentTemplates.js:30` | `GET` | `/api/master/document-templates/{param}/download` | `/api/master/document-templates/{template_id}/download` | `Successful Response` | OK |
| `frontend/src/api/documentTemplates.js:37` | `GET` | `/api/master/document-templates/assignments/{param}/available` | `/api/master/document-templates/assignments/{assignment_id}/available` | `AvailableTemplatesResponse` | OK |
| `frontend/src/api/documentTemplates.js:44` | `POST` | `/api/master/document-templates/assignments/{param}/from-template/{param}` | `/api/master/document-templates/assignments/{assignment_id}/from-template/{template_id}` | `object` | OK |
| `frontend/src/api/documents.js:4` | `GET` | `/api/assignments/{param}/documents` | `/api/assignments/{assignment_id}/documents` | `array<DocumentRead>` | OK |
| `frontend/src/api/documents.js:13` | `POST` | `/api/assignments/{param}/documents/upload` | `/api/assignments/{assignment_id}/documents/upload` | `DocumentRead` | OK |
| `frontend/src/api/documents.js:24` | `POST` | `/api/assignments/{param}/documents/upload` | `/api/assignments/{assignment_id}/documents/upload` | `DocumentRead` | OK |
| `frontend/src/api/documents.js:31` | `POST` | `/api/assignments/{param}/documents/{param}/final` | `/api/assignments/{assignment_id}/documents/{document_id}/final` | `DocumentRead` | OK |
| `frontend/src/api/documents.js:38` | `POST` | `/api/assignments/{param}/documents/{param}/review` | `/api/assignments/{assignment_id}/documents/{document_id}/review` | `DocumentReviewResponse` | OK |
| `frontend/src/api/invoices.js:4` | `GET` | `/api/invoices` | `/api/invoices` | `InvoiceListResponse` | OK |
| `frontend/src/api/invoices.js:9` | `GET` | `/api/invoices/{param}` | `/api/invoices/{invoice_id}` | `InvoiceRead` | OK |
| `frontend/src/api/invoices.js:14` | `GET` | `/api/invoices/{param}/context` | `/api/invoices/{invoice_id}/context` | `object` | OK |
| `frontend/src/api/invoices.js:19` | `POST` | `/api/invoices` | `/api/invoices` | `InvoiceRead` | OK |
| `frontend/src/api/invoices.js:24` | `PATCH` | `/api/invoices/{param}` | `/api/invoices/{invoice_id}` | `InvoiceRead` | OK |
| `frontend/src/api/invoices.js:29` | `POST` | `/api/invoices/{param}/issue` | `/api/invoices/{invoice_id}/issue` | `InvoiceRead` | OK |
| `frontend/src/api/invoices.js:34` | `POST` | `/api/invoices/{param}/mark-paid` | `/api/invoices/{invoice_id}/mark-paid` | `schema` | OK |
| `frontend/src/api/invoices.js:39` | `GET` | `/api/invoices/{param}/pdf` | `/api/invoices/{invoice_id}/pdf` | `Successful Response` | OK |
| `frontend/src/api/invoices.js:49` | `POST` | `/api/invoices/{param}/remind` | `/api/invoices/{invoice_id}/remind` | `object` | OK |
| `frontend/src/api/invoices.js:54` | `POST` | `/api/invoices/{param}/send` | `/api/invoices/{invoice_id}/send` | `InvoiceRead` | OK |
| `frontend/src/api/invoices.js:59` | `POST` | `/api/invoices/{param}/payments` | `/api/invoices/{invoice_id}/payments` | `InvoiceRead` | OK |
| `frontend/src/api/invoices.js:64` | `POST` | `/api/invoices/{param}/adjustments` | `/api/invoices/{invoice_id}/adjustments` | `InvoiceRead` | OK |
| `frontend/src/api/invoices.js:69` | `POST` | `/api/invoices/{param}/void` | `/api/invoices/{invoice_id}/void` | `InvoiceRead` | OK |
| `frontend/src/api/invoices.js:74` | `GET` | `/api/invoices/export.csv` | `/api/invoices/export.csv` | `Successful Response` | OK |
| `frontend/src/api/invoices.js:82` | `GET` | `/api/invoices/{param}/attachments` | `/api/invoices/{invoice_id}/attachments` | `array<InvoiceAttachmentRead>` | OK |
| `frontend/src/api/invoices.js:90` | `POST` | `/api/invoices/{param}/attachments/upload` | `/api/invoices/{invoice_id}/attachments/upload` | `InvoiceAttachmentRead` | OK |
| `frontend/src/api/invoices.js:95` | `GET` | `/api/invoices/{param}/attachments/{param}/download` | `/api/invoices/{invoice_id}/attachments/{attachment_id}/download` | `Successful Response` | OK |
| `frontend/src/api/invoices.js:102` | `DELETE` | `/api/invoices/{param}/attachments/{param}` | `/api/invoices/{invoice_id}/attachments/{attachment_id}` | `object` | OK |
| `frontend/src/api/leave.js:4` | `GET` | `/api/leave/my` | `/api/leave/my` | `array<LeaveRequestRead>` | OK |
| `frontend/src/api/leave.js:9` | `GET` | `/api/leave/inbox` | `/api/leave/inbox` | `array<LeaveRequestRead>` | OK |
| `frontend/src/api/leave.js:14` | `POST` | `/api/leave/request` | `/api/leave/request` | `LeaveRequestRead` | OK |
| `frontend/src/api/leave.js:19` | `POST` | `/api/leave/{param}/approve` | `/api/leave/{leave_id}/approve` | `LeaveRequestRead` | OK |
| `frontend/src/api/leave.js:24` | `POST` | `/api/leave/{param}/reject` | `/api/leave/{leave_id}/reject` | `LeaveRequestRead` | OK |
| `frontend/src/api/master.js:4` | `GET` | `/api/master/banks` | `/api/master/banks` | `array<BankRead>` | OK |
| `frontend/src/api/master.js:9` | `GET` | `/api/master/branches` | `/api/master/branches` | `array<BranchRead>` | OK |
| `frontend/src/api/master.js:14` | `GET` | `/api/master/clients` | `/api/master/clients` | `array<ClientRead>` | OK |
| `frontend/src/api/master.js:19` | `GET` | `/api/master/property-types` | `/api/master/property-types` | `array<PropertyTypeRead>` | OK |
| `frontend/src/api/master.js:24` | `GET` | `/api/master/property-subtypes` | `/api/master/property-subtypes` | `array<PropertySubtypeRead>` | OK |
| `frontend/src/api/master.js:31` | `GET` | `/api/master/company-accounts` | `/api/master/company-accounts` | `array<app__schemas__company__CompanyAccountRead>` | OK |
| `frontend/src/api/master.js:38` | `GET` | `/api/master/doc-templates` | `/api/master/doc-templates` | `array<DocumentChecklistTemplateRead>` | OK |
| `frontend/src/api/master.js:43` | `GET` | `/api/master/company-profile` | `/api/master/company-profile` | `CompanyProfileRead` | OK |
| `frontend/src/api/master.js:48` | `GET` | `/api/master/calendar-labels` | `/api/master/calendar-labels` | `array<CalendarEventLabelRead>` | OK |
| `frontend/src/api/master.js:53` | `GET` | `/api/master/partners` | `/api/master/partners` | `array<ExternalPartnerRead>` | OK |
| `frontend/src/api/master.js:58` | `POST` | `/api/master/banks` | `/api/master/banks` | `BankRead` | OK |
| `frontend/src/api/master.js:63` | `PATCH` | `/api/master/banks/{param}` | `/api/master/banks/{bank_id}` | `BankRead` | OK |
| `frontend/src/api/master.js:68` | `POST` | `/api/master/branches` | `/api/master/branches` | `BranchRead` | OK |
| `frontend/src/api/master.js:73` | `PATCH` | `/api/master/branches/{param}` | `/api/master/branches/{branch_id}` | `BranchRead` | OK |
| `frontend/src/api/master.js:78` | `POST` | `/api/master/clients` | `/api/master/clients` | `ClientRead` | OK |
| `frontend/src/api/master.js:83` | `PATCH` | `/api/master/clients/{param}` | `/api/master/clients/{client_id}` | `ClientRead` | OK |
| `frontend/src/api/master.js:88` | `POST` | `/api/master/property-types` | `/api/master/property-types` | `PropertyTypeRead` | OK |
| `frontend/src/api/master.js:93` | `PATCH` | `/api/master/property-types/{param}` | `/api/master/property-types/{prop_id}` | `PropertyTypeRead` | OK |
| `frontend/src/api/master.js:98` | `POST` | `/api/master/property-subtypes` | `/api/master/property-subtypes` | `PropertySubtypeRead` | OK |
| `frontend/src/api/master.js:103` | `PATCH` | `/api/master/property-subtypes/{param}` | `/api/master/property-subtypes/{subtype_id}` | `PropertySubtypeRead` | OK |
| `frontend/src/api/master.js:108` | `POST` | `/api/master/company-accounts` | `/api/master/company-accounts` | `app__schemas__company__CompanyAccountRead` | OK |
| `frontend/src/api/master.js:113` | `PATCH` | `/api/master/company-accounts/{param}` | `/api/master/company-accounts/{account_id}` | `app__schemas__company__CompanyAccountRead` | OK |
| `frontend/src/api/master.js:118` | `PATCH` | `/api/master/company-profile` | `/api/master/company-profile` | `CompanyProfileRead` | OK |
| `frontend/src/api/master.js:123` | `POST` | `/api/master/calendar-labels` | `/api/master/calendar-labels` | `CalendarEventLabelRead` | OK |
| `frontend/src/api/master.js:128` | `PATCH` | `/api/master/calendar-labels/{param}` | `/api/master/calendar-labels/{label_id}` | `CalendarEventLabelRead` | OK |
| `frontend/src/api/master.js:133` | `POST` | `/api/master/doc-templates` | `/api/master/doc-templates` | `DocumentChecklistTemplateRead` | OK |
| `frontend/src/api/master.js:138` | `PATCH` | `/api/master/doc-templates/{param}` | `/api/master/doc-templates/{template_id}` | `DocumentChecklistTemplateRead` | OK |
| `frontend/src/api/master.js:143` | `POST` | `/api/master/partners` | `/api/master/partners` | `ExternalPartnerRead` | OK |
| `frontend/src/api/master.js:148` | `PATCH` | `/api/master/partners/{param}` | `/api/master/partners/{partner_id}` | `ExternalPartnerRead` | OK |
| `frontend/src/api/master.js:153` | `DELETE` | `/api/master/partners/{param}` | `/api/master/partners/{partner_id}` | `object` | OK |
| `frontend/src/api/messages.js:4` | `GET` | `/api/assignments/{param}/messages` | `/api/assignments/{assignment_id}/messages` | `array<MessageRead>` | OK |
| `frontend/src/api/messages.js:9` | `POST` | `/api/assignments/{param}/messages` | `/api/assignments/{assignment_id}/messages` | `MessageRead` | OK |
| `frontend/src/api/messages.js:14` | `PATCH` | `/api/assignments/{param}/messages/{param}` | `/api/assignments/{assignment_id}/messages/{message_id}` | `MessageRead` | OK |
| `frontend/src/api/messages.js:19` | `POST` | `/api/assignments/{param}/messages/{param}/pin` | `/api/assignments/{assignment_id}/messages/{message_id}/pin` | `MessageRead` | OK |
| `frontend/src/api/messages.js:24` | `POST` | `/api/assignments/{param}/messages/{param}/unpin` | `/api/assignments/{assignment_id}/messages/{message_id}/unpin` | `MessageRead` | OK |
| `frontend/src/api/messages.js:29` | `DELETE` | `/api/assignments/{param}/messages/{param}` | `/api/assignments/{assignment_id}/messages/{message_id}` | `Successful Response` | OK |
| `frontend/src/api/notifications.js:4` | `GET` | `/api/notifications` | `/api/notifications` | `array<NotificationRead>` | OK |
| `frontend/src/api/notifications.js:9` | `POST` | `/api/notifications/{param}/read` | `/api/notifications/{notification_id}/read` | `NotificationRead` | OK |
| `frontend/src/api/notifications.js:14` | `POST` | `/api/notifications/read-all` | `/api/notifications/read-all` | `object` | OK |
| `frontend/src/api/notifications.js:19` | `GET` | `/api/notifications/unread-count` | `/api/notifications/unread-count` | `object` | OK |
| `frontend/src/api/notifications.js:24` | `POST` | `/api/notifications/sweep` | `/api/notifications/sweep` | `object` | OK |
| `frontend/src/api/notifications.js:29` | `POST` | `/api/notifications/snooze` | `/api/notifications/snooze` | `object` | OK |
| `frontend/src/api/notifications.js:34` | `GET` | `/api/notifications/deliveries` | `/api/notifications/deliveries` | `array<NotificationDeliveryRead>` | OK |
| `frontend/src/api/partner.js:4` | `GET` | `/api/partner/commissions` | `/api/partner/commissions` | `array<CommissionRequestSummary>` | OK |
| `frontend/src/api/partner.js:9` | `GET` | `/api/partner/commissions/{param}` | `/api/partner/commissions/{commission_id}` | `CommissionRequestRead` | OK |
| `frontend/src/api/partner.js:14` | `POST` | `/api/partner/commissions` | `/api/partner/commissions` | `CommissionRequestRead` | OK |
| `frontend/src/api/partner.js:19` | `PATCH` | `/api/partner/commissions/{param}` | `/api/partner/commissions/{commission_id}` | `CommissionRequestRead` | OK |
| `frontend/src/api/partner.js:24` | `POST` | `/api/partner/commissions/{param}/submit` | `/api/partner/commissions/{commission_id}/submit` | `CommissionRequestRead` | OK |
| `frontend/src/api/partner.js:32` | `POST` | `/api/partner/commissions/{param}/uploads` | `/api/partner/commissions/{commission_id}/uploads` | `CommissionRequestDocumentRead` | OK |
| `frontend/src/api/partner.js:37` | `GET` | `/api/partner/requests` | `/api/partner/requests` | `array<PartnerRequestRead>` | OK |
| `frontend/src/api/partner.js:42` | `POST` | `/api/partner/requests/{param}/respond` | `/api/partner/requests/{request_id}/respond` | `PartnerRequestRead` | OK |
| `frontend/src/api/partner.js:51` | `POST` | `/api/partner/requests/{param}/uploads` | `/api/partner/requests/{request_id}/uploads` | `PartnerRequestAttachmentRead` | OK |
| `frontend/src/api/partner.js:56` | `GET` | `/api/partner/requests/{param}/attachments` | `/api/partner/requests/{request_id}/attachments` | `array<PartnerRequestAttachmentRead>` | OK |
| `frontend/src/api/partner.js:61` | `GET` | `/api/partner/assignments` | `/api/partner/assignments` | `array<PartnerAssignmentSummary>` | OK |
| `frontend/src/api/partner.js:66` | `GET` | `/api/partner/assignments/{param}` | `/api/partner/assignments/{assignment_id}` | `PartnerAssignmentDetail` | OK |
| `frontend/src/api/partner.js:71` | `GET` | `/api/partner/invoices` | `/api/partner/invoices` | `array<PartnerInvoiceSummary>` | OK |
| `frontend/src/api/partner.js:76` | `GET` | `/api/partner/invoices/{param}` | `/api/partner/invoices/{invoice_id}` | `PartnerInvoiceDetail` | OK |
| `frontend/src/api/partner.js:81` | `GET` | `/api/partner/assignments/{param}/deliverables` | `/api/partner/assignments/{assignment_id}/deliverables` | `array<PartnerDeliverableRead>` | OK |
| `frontend/src/api/partner.js:86` | `GET` | `/api/partner/deliverables/{param}/download` | `/api/partner/deliverables/{deliverable_id}/download` | `Successful Response` | OK |
| `frontend/src/api/partner.js:91` | `GET` | `/api/partner/profile` | `/api/partner/profile` | `ExternalPartnerRead` | OK |
| `frontend/src/api/partner.js:96` | `GET` | `/api/partner/notifications` | `/api/partner/notifications` | `array<NotificationRead>` | OK |
| `frontend/src/api/partner.js:101` | `GET` | `/api/partner/notifications/unread-count` | `/api/partner/notifications/unread-count` | `object` | OK |
| `frontend/src/api/partner.js:106` | `POST` | `/api/partner/notifications/{param}/read` | `/api/partner/notifications/{notification_id}/read` | `NotificationRead` | OK |
| `frontend/src/api/partner.js:111` | `POST` | `/api/partner/notifications/read-all` | `/api/partner/notifications/read-all` | `object` | OK |
| `frontend/src/api/partnerAdmin.js:4` | `GET` | `/api/admin/commissions` | `/api/admin/commissions` | `array<CommissionRequestSummary>` | OK |
| `frontend/src/api/partnerAdmin.js:9` | `GET` | `/api/admin/commissions/{param}` | `/api/admin/commissions/{commission_id}` | `CommissionRequestAdminRead` | OK |
| `frontend/src/api/partnerAdmin.js:14` | `POST` | `/api/admin/commissions/{param}/approve` | `/api/admin/commissions/{commission_id}/approve` | `CommissionRequestAdminRead` | OK |
| `frontend/src/api/partnerAdmin.js:19` | `POST` | `/api/admin/commissions/{param}/reject` | `/api/admin/commissions/{commission_id}/reject` | `CommissionRequestAdminRead` | OK |
| `frontend/src/api/partnerAdmin.js:24` | `POST` | `/api/admin/commissions/{param}/needs-info` | `/api/admin/commissions/{commission_id}/needs-info` | `CommissionRequestAdminRead` | OK |
| `frontend/src/api/payroll.js:11` | `GET` | `/api/payroll/runs` | `/api/payroll/runs` | `array<PayrollRunResponse>` | OK |
| `frontend/src/api/payroll.js:16` | `GET` | `/api/payroll/runs/{param}` | `/api/payroll/runs/{payroll_run_id}` | `PayrollRunDetailResponse` | OK |
| `frontend/src/api/payroll.js:21` | `POST` | `/api/payroll/runs` | `/api/payroll/runs` | `PayrollRunResponse` | OK |
| `frontend/src/api/payroll.js:26` | `POST` | `/api/payroll/runs/{param}/calculate` | `/api/payroll/runs/{payroll_run_id}/calculate` | `Successful Response` | OK |
| `frontend/src/api/payroll.js:31` | `POST` | `/api/payroll/runs/{param}/send-approval` | `/api/payroll/runs/{payroll_run_id}/send-approval` | `Successful Response` | OK |
| `frontend/src/api/payroll.js:36` | `POST` | `/api/payroll/runs/{param}/approve` | `/api/payroll/runs/{payroll_run_id}/approve` | `Successful Response` | OK |
| `frontend/src/api/payroll.js:41` | `POST` | `/api/payroll/runs/{param}/mark-paid` | `/api/payroll/runs/{payroll_run_id}/mark-paid` | `Successful Response` | OK |
| `frontend/src/api/payroll.js:46` | `POST` | `/api/payroll/runs/{param}/close` | `/api/payroll/runs/{payroll_run_id}/close` | `Successful Response` | OK |
| `frontend/src/api/payroll.js:51` | `GET` | `/api/payroll/runs/{param}/export/{param}` | `/api/payroll/runs/{payroll_run_id}/export/{export_type}` | `Successful Response` | OK |
| `frontend/src/api/payroll.js:65` | `GET` | `/api/payroll/salary-structures` | `/api/payroll/salary-structures` | `array<SalaryStructureResponse>` | OK |
| `frontend/src/api/payroll.js:70` | `GET` | `/api/payroll/salary-structures/{param}` | `/api/payroll/salary-structures/{user_id}` | `array<SalaryStructureResponse>` | OK |
| `frontend/src/api/payroll.js:75` | `POST` | `/api/payroll/salary-structures` | `/api/payroll/salary-structures` | `SalaryStructureResponse` | OK |
| `frontend/src/api/payroll.js:80` | `PATCH` | `/api/payroll/salary-structures/{param}` | `/api/payroll/salary-structures/{structure_id}` | `SalaryStructureResponse` | OK |
| `frontend/src/api/payroll.js:90` | `GET` | `/api/payroll/payslips` | `/api/payroll/payslips` | `array<PayslipResponse>` | OK |
| `frontend/src/api/payroll.js:95` | `GET` | `/api/payroll/payslips/my` | `/api/payroll/payslips/my` | `array<PayslipResponse>` | OK |
| `frontend/src/api/payroll.js:100` | `GET` | `/api/payroll/payslips/{param}/download` | `/api/payroll/payslips/{payslip_id}/download` | `Successful Response` | OK |
| `frontend/src/api/payroll.js:107` | `POST` | `/api/payroll/payslips/{param}/generate` | `/api/payroll/payslips/{payslip_id}/generate` | `Successful Response` | OK |
| `frontend/src/api/payroll.js:112` | `POST` | `/api/payroll/payslips/{param}/send-email` | `/api/payroll/payslips/{payslip_id}/send-email` | `Successful Response` | OK |
| `frontend/src/api/payroll.js:118` | `GET` | `/api/payroll/stats` | `/api/payroll/stats` | `Successful Response` | OK |
| `frontend/src/api/payroll.js:123` | `GET` | `/api/payroll/policy` | `/api/payroll/policy` | `PayrollPolicyResponse` | OK |
| `frontend/src/api/payroll.js:128` | `PATCH` | `/api/payroll/policy` | `/api/payroll/policy` | `PayrollPolicyResponse` | OK |
| `frontend/src/api/support.js:6` | `GET` | `/api/support/public/config` | `/api/support/public/config` | `PublicConfigResponse` | OK |
| `frontend/src/api/support.js:13` | `GET` | `/api/support/threads` | `/api/support/threads` | `array<SupportThreadResponse>` | OK |
| `frontend/src/api/support.js:18` | `POST` | `/api/support/threads` | `/api/support/threads` | `SupportThreadResponse` | OK |
| `frontend/src/api/support.js:23` | `GET` | `/api/support/threads/{param}` | `/api/support/threads/{thread_id}` | `SupportThreadDetail` | OK |
| `frontend/src/api/support.js:28` | `PATCH` | `/api/support/threads/{param}` | `/api/support/threads/{thread_id}` | `SupportThreadResponse` | OK |
| `frontend/src/api/support.js:33` | `POST` | `/api/support/threads/{param}/messages` | `/api/support/threads/{thread_id}/messages` | `SupportMessageResponse` | OK |
| `frontend/src/api/support.js:38` | `POST` | `/api/support/threads/{param}/resolve` | `/api/support/threads/{thread_id}/resolve` | `SupportThreadResponse` | OK |
| `frontend/src/api/support.js:43` | `POST` | `/api/support/threads/{param}/close` | `/api/support/threads/{thread_id}/close` | `SupportThreadResponse` | OK |
| `frontend/src/api/support.js:50` | `POST` | `/api/support/tokens` | `/api/support/tokens` | `SupportTokenResponse` | OK |
| `frontend/src/api/support.js:55` | `POST` | `/api/support/tokens/{param}/revoke` | `/api/support/tokens/{token_id}/revoke` | `Successful Response` | OK |
| `frontend/src/api/support.js:62` | `GET` | `/api/support/portal/context` | `/api/support/portal/context` | `SupportTokenContext` | OK |
| `frontend/src/api/support.js:67` | `POST` | `/api/support/portal/threads` | `/api/support/portal/threads` | `SupportThreadResponse` | OK |
| `frontend/src/api/support.js:72` | `POST` | `/api/support/portal/threads/{param}/messages` | `/api/support/portal/threads/{thread_id}/messages` | `SupportMessageResponse` | OK |
| `frontend/src/api/tasks.js:4` | `GET` | `/api/assignments/{param}/tasks` | `/api/assignments/{assignment_id}/tasks` | `array<TaskRead>` | OK |
| `frontend/src/api/tasks.js:9` | `POST` | `/api/assignments/{param}/tasks` | `/api/assignments/{assignment_id}/tasks` | `TaskRead` | OK |
| `frontend/src/api/tasks.js:14` | `PATCH` | `/api/assignments/{param}/tasks/{param}` | `/api/assignments/{assignment_id}/tasks/{task_id}` | `TaskRead` | OK |
| `frontend/src/api/tasks.js:19` | `DELETE` | `/api/assignments/{param}/tasks/{param}` | `/api/assignments/{assignment_id}/tasks/{task_id}` | `Successful Response` | OK |
| `frontend/src/api/tasks.js:24` | `GET` | `/api/tasks/my` | `/api/tasks/my` | `array<TaskWithAssignment>` | OK |
| `frontend/src/api/tasks.js:29` | `GET` | `/api/tasks/queue` | `/api/tasks/queue` | `array<TaskWithAssignment>` | OK |
| `frontend/src/api/users.js:4` | `GET` | `/api/auth/users` | `/api/auth/users` | `array<UserSummary>` | OK |
| `frontend/src/api/users.js:9` | `GET` | `/api/auth/users/directory` | `/api/auth/users/directory` | `array<UserDirectory>` | OK |
| `frontend/src/api/users.js:16` | `POST` | `/api/auth/users` | `/api/auth/users` | `UserRead` | OK |
| `frontend/src/api/users.js:21` | `PATCH` | `/api/auth/users/{param}` | `/api/auth/users/{user_id}` | `UserRead` | OK |
| `frontend/src/api/users.js:26` | `POST` | `/api/auth/users/{param}/reset-password` | `/api/auth/users/{user_id}/reset-password` | `schema` | OK |
| `frontend/src/api/users.js:31` | `PATCH` | `/api/auth/me` | `/api/auth/me` | `UserRead` | OK |
| `frontend/src/auth/AuthContext.jsx:40` | `GET` | `/api/auth/me` | `/api/auth/me` | `UserRead` | OK |
| `frontend/src/auth/AuthContext.jsx:41` | `GET` | `/api/auth/capabilities` | `/api/auth/capabilities` | `CapabilityResponse` | OK |
| `frontend/src/auth/AuthContext.jsx:72` | `POST` | `/api/auth/login` | `/api/auth/login` | `LoginResponse` | OK |
| `frontend/src/auth/AuthContext.jsx:96` | `POST` | `/api/auth/mfa/verify` | `/api/auth/mfa/verify` | `LoginResponse` | OK |
| `frontend/src/auth/AuthContext.jsx:116` | `POST` | `/api/auth/mfa/verify-backup` | `/api/auth/mfa/verify-backup` | `LoginResponse` | OK |
| `frontend/src/auth/AuthContext.jsx:140` | `POST` | `/api/auth/logout` | `/api/auth/logout` | `object` | OK |
| `frontend/src/auth/AuthContext.jsx:173` | `POST` | `/api/auth/heartbeat` | `/api/auth/heartbeat` | `LoginResponse` | OK |
| `frontend/src/auth/AuthContext.jsx:223` | `POST` | `/api/auth/heartbeat` | `/api/auth/heartbeat` | `LoginResponse` | OK |
| `frontend/src/components/DocumentComments.jsx:37` | `GET` | `/api/document-comments` | `/api/document-comments/` | `DocumentCommentListResponse` | OK |
| `frontend/src/components/DocumentComments.jsx:63` | `POST` | `/api/document-comments` | `/api/document-comments/` | `DocumentCommentOut` | OK |
| `frontend/src/components/DocumentComments.jsx:86` | `POST` | `/api/document-comments/{param}/resolve` | `/api/document-comments/{comment_id}/resolve` | `DocumentCommentOut` | OK |
| `frontend/src/components/DocumentComments.jsx:100` | `DELETE` | `/api/document-comments/{param}` | `/api/document-comments/{comment_id}` | `Successful Response` | OK |
| `frontend/src/components/ErrorBoundary.jsx:43` | `POST` | `/api/client-logs` | `/api/client-logs` | `object` | OK |
| `frontend/src/components/StepUpMFAModal.jsx:14` | `POST` | `/api/auth/step-up/verify` | `/api/auth/step-up/verify` | `StepUpTokenResponse` | OK |
| `frontend/src/pages/Account.jsx:512` | `POST` | `/api/auth/totp/setup` | `/api/auth/totp/setup` | `TOTPSetupResponse` | OK |
| `frontend/src/pages/Account.jsx:527` | `POST` | `/api/auth/totp/verify-setup` | `/api/auth/totp/verify-setup` | `object` | OK |
| `frontend/src/pages/Account.jsx:544` | `POST` | `/api/auth/totp/disable` | `/api/auth/totp/disable` | `object` | OK |
| `frontend/src/pages/Account.jsx:561` | `POST` | `/api/auth/totp/regenerate-backup-codes` | `/api/auth/totp/regenerate-backup-codes` | `BackupCodesResponse` | OK |
| `frontend/src/pages/Account.jsx:748` | `POST` | `/api/notifications/whatsapp/opt-in` | `/api/notifications/whatsapp/opt-in` | `object` | OK |
| `frontend/src/pages/Account.jsx:764` | `POST` | `/api/notifications/whatsapp/opt-out` | `/api/notifications/whatsapp/opt-out` | `object` | OK |
| `frontend/src/pages/AdminDashboard.jsx:19` | `GET` | `/api/assignments/summary` | `/api/assignments/summary` | `AssignmentSummary` | OK |
| `frontend/src/pages/AdminDashboard.jsx:20` | `GET` | `/api/assignments/workload` | `/api/assignments/workload` | `array<UserWorkload>` | OK |
| `frontend/src/pages/PartnerRequestAccess.jsx:30` | `POST` | `/api/partner/request-access` | `/api/partner/request-access` | `PartnerAccountRequestRead` | OK |
| `frontend/src/pages/admin/AdminAttendance.jsx:17` | `GET` | `/api/auth/users/directory` | `/api/auth/users/directory` | `array<UserDirectory>` | OK |
| `frontend/src/pages/admin/AdminPartnerRequests.jsx:21` | `GET` | `/api/admin/partner-account-requests` | `/api/admin/partner-account-requests` | `array<PartnerAccountRequestRead>` | OK |
| `frontend/src/pages/admin/AdminPartnerRequests.jsx:34` | `POST` | `/api/admin/partner-account-requests/{param}/approve` | `/api/admin/partner-account-requests/{request_id}/approve` | `PartnerAccountRequestRead` | OK |
| `frontend/src/pages/admin/AdminPartnerRequests.jsx:48` | `POST` | `/api/admin/partner-account-requests/{param}/reject` | `/api/admin/partner-account-requests/{request_id}/reject` | `PartnerAccountRequestRead` | OK |
| `frontend/src/pages/admin/AdminSystemConfig.jsx:29` | `GET` | `/api/support/config` | `/api/support/config` | `object` | OK |
| `frontend/src/pages/admin/AdminSystemConfig.jsx:59` | `PUT` | `/api/support/config` | `/api/support/config` | `object` | OK |
