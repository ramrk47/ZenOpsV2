import React from 'react'
import PageHeader from '../../components/ui/PageHeader'
import { Card, CardHeader } from '../../components/ui/Card'

export default function PartnerHelp() {
  return (
    <div>
      <PageHeader
        title="Help & Support"
        subtitle="How to get assistance with your requests and payments."
      />

      <div className="grid" style={{ gap: '1rem' }}>
        <Card>
          <CardHeader title="Need documents?" subtitle="Respond to requests quickly to avoid delays." />
          <div className="muted">
            All communication happens inside the Requests tab. Upload requested documents or clarifications directly there.
          </div>
        </Card>
        <Card>
          <CardHeader title="Payment verification" subtitle="Deliverables unlock after verification." />
          <div className="muted">
            Upload payment proof from the Payments section. Finance will verify and unlock the final report.
          </div>
        </Card>
        <Card>
          <CardHeader title="Contact" subtitle="Reach the admin team" />
          <div className="muted">
            For urgent changes, contact your Zen Ops admin or operations manager.
          </div>
        </Card>
      </div>
    </div>
  )
}
