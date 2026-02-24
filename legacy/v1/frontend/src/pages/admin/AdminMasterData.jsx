import React, { useEffect, useMemo, useState } from 'react'
import PageHeader from '../../components/ui/PageHeader'
import Badge from '../../components/ui/Badge'
import InfoTip from '../../components/ui/InfoTip'
import Tabs from '../../components/ui/Tabs'
import { Card, CardHeader } from '../../components/ui/Card'
import EmptyState from '../../components/ui/EmptyState'
import DataTable from '../../components/ui/DataTable'
import {
  fetchBanks,
  fetchBranches,
  fetchClients,
  fetchPropertyTypes,
  fetchPropertySubtypes,
  fetchDocTemplates,
  fetchCalendarLabels,
  fetchCompanyProfile,
  fetchExternalPartners,
  createBank,
  updateBank,
  createBranch,
  updateBranch,
  createClient,
  updateClient,
  createPropertyType,
  updatePropertyType,
  createPropertySubtype,
  updatePropertySubtype,
  createDocTemplate,
  updateDocTemplate,
  createCalendarLabel,
  updateCalendarLabel,
  updateCompanyProfile,
  createExternalPartner,
  updateExternalPartner,
} from '../../api/master'
import { titleCase } from '../../utils/format'
import { toUserMessage } from '../../api/client'

const TABS = [
  { key: 'banks', label: 'Banks' },
  { key: 'branches', label: 'Branches' },
  { key: 'clients', label: 'Clients' },
  { key: 'partners', label: 'Partners' },
  { key: 'property', label: 'Property Types' },
  { key: 'subtypes', label: 'Property Subtypes' },
  { key: 'templates', label: 'Doc Templates' },
  { key: 'calendar', label: 'Calendar Labels' },
  { key: 'company', label: 'Company Profile' },
]

const CASE_TYPES = ['BANK', 'EXTERNAL_VALUER', 'DIRECT_CLIENT']
const CALENDAR_EVENT_TYPES = ['SITE_VISIT', 'REPORT_DUE', 'DOC_PICKUP', 'INTERNAL_MEETING', 'TASK_DUE', 'LEAVE']
const SERVICE_LINES = ['VALUATION', 'INDUSTRIAL', 'DPR', 'CMA']

function mapById(items) {
  const map = new Map()
  items.forEach((item) => map.set(item.id, item))
  return map
}

export default function AdminMasterData() {
  const [activeTab, setActiveTab] = useState('banks')

  const [banks, setBanks] = useState([])
  const [branches, setBranches] = useState([])
  const [clients, setClients] = useState([])
  const [partners, setPartners] = useState([])
  const [propertyTypes, setPropertyTypes] = useState([])
  const [propertySubtypes, setPropertySubtypes] = useState([])
  const [templates, setTemplates] = useState([])
  const [calendarLabels, setCalendarLabels] = useState([])
  const [companyProfile, setCompanyProfile] = useState(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  const [bankDrafts, setBankDrafts] = useState({})
  const [branchDrafts, setBranchDrafts] = useState({})
  const [clientDrafts, setClientDrafts] = useState({})
  const [partnerDrafts, setPartnerDrafts] = useState({})
  const [propertyDrafts, setPropertyDrafts] = useState({})
  const [propertySubtypeDrafts, setPropertySubtypeDrafts] = useState({})
  const [templateDrafts, setTemplateDrafts] = useState({})
  const [calendarLabelDrafts, setCalendarLabelDrafts] = useState({})

  const [bankForm, setBankForm] = useState({ name: '', code: '', is_active: true })
  const [branchForm, setBranchForm] = useState({ bank_id: '', name: '', code: '', city: '', state: '', is_active: true })
  const [clientForm, setClientForm] = useState({ name: '', client_type: '', contact_name: '', contact_phone: '', contact_email: '', is_active: true })
  const [partnerForm, setPartnerForm] = useState({
    display_name: '',
    legal_name: '',
    contact_name: '',
    email: '',
    phone: '',
    alternate_contact_name: '',
    alternate_contact_email: '',
    alternate_contact_phone: '',
    city: '',
    gstin: '',
    billing_address: '',
    billing_city: '',
    billing_state: '',
    billing_postal_code: '',
    service_lines: [],
    multi_floor_enabled: false,
    notes: '',
    is_active: true,
  })
  const [propertyForm, setPropertyForm] = useState({ name: '', description: '', is_active: true })
  const [propertySubtypeForm, setPropertySubtypeForm] = useState({
    property_type_id: '',
    name: '',
    description: '',
    is_active: true,
  })
  const [templateForm, setTemplateForm] = useState({
    bank_id: '',
    branch_id: '',
    property_type_id: '',
    property_subtype_id: '',
    case_type: '',
    category: '',
    required: true,
    notes: '',
  })
  const [calendarLabelForm, setCalendarLabelForm] = useState({
    name: '',
    description: '',
    default_event_type: 'INTERNAL_MEETING',
    is_active: true,
  })
  const [companyProfileForm, setCompanyProfileForm] = useState({
    business_name: '',
    legal_name: '',
    tagline: '',
    address_line1: '',
    address_line2: '',
    city: '',
    state_name: '',
    state_code: '',
    postal_code: '',
    country: '',
    gstin: '',
    pan: '',
    contact_email: '',
    contact_phone: '',
    website: '',
    default_gst_rate: '18.00',
    notes: '',
  })

  useEffect(() => {
    let cancelled = false

    async function loadAll() {
      setLoading(true)
      setError(null)
      try {
        const [
          bankData,
          branchData,
          clientData,
          partnerData,
          propertyData,
          subtypeData,
          templateData,
          labelData,
          profileData,
        ] = await Promise.all([
          fetchBanks(),
          fetchBranches(),
          fetchClients(),
          fetchExternalPartners().catch(() => []),
          fetchPropertyTypes(),
          fetchPropertySubtypes().catch(() => []),
          fetchDocTemplates(),
          fetchCalendarLabels().catch(() => []),
          fetchCompanyProfile().catch(() => null),
        ])
        if (cancelled) return
        setBanks(bankData)
        setBranches(branchData)
        setClients(clientData)
        setPartners(partnerData)
        setPropertyTypes(propertyData)
        setPropertySubtypes(subtypeData)
        setTemplates(templateData)
        setCalendarLabels(labelData)
        setCompanyProfile(profileData)
      } catch (err) {
        console.error(err)
        if (!cancelled) setError(toUserMessage(err, 'Failed to load master data'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAll()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  useEffect(() => {
    const drafts = {}
    banks.forEach((bank) => {
      drafts[bank.id] = { name: bank.name, code: bank.code || '', is_active: bank.is_active }
    })
    setBankDrafts(drafts)
  }, [banks])

  useEffect(() => {
    const drafts = {}
    branches.forEach((branch) => {
      drafts[branch.id] = {
        bank_id: String(branch.bank_id),
        name: branch.name,
        code: branch.code || '',
        city: branch.city || '',
        state: branch.state || '',
        is_active: branch.is_active,
      }
    })
    setBranchDrafts(drafts)
  }, [branches])

  useEffect(() => {
    const drafts = {}
    clients.forEach((client) => {
      drafts[client.id] = {
        name: client.name,
        client_type: client.client_type || '',
        contact_name: client.contact_name || '',
        contact_phone: client.contact_phone || '',
        contact_email: client.contact_email || '',
        is_active: client.is_active,
      }
    })
    setClientDrafts(drafts)
  }, [clients])

  useEffect(() => {
    const drafts = {}
    partners.forEach((partner) => {
      drafts[partner.id] = {
        display_name: partner.display_name || '',
        legal_name: partner.legal_name || '',
        contact_name: partner.contact_name || '',
        email: partner.email || '',
        phone: partner.phone || '',
        alternate_contact_name: partner.alternate_contact_name || '',
        alternate_contact_email: partner.alternate_contact_email || '',
        alternate_contact_phone: partner.alternate_contact_phone || '',
        city: partner.city || '',
        gstin: partner.gstin || '',
        billing_address: partner.billing_address || '',
        billing_city: partner.billing_city || '',
        billing_state: partner.billing_state || '',
        billing_postal_code: partner.billing_postal_code || '',
        service_lines: partner.service_lines || [],
        multi_floor_enabled: Boolean(partner.multi_floor_enabled),
        notes: partner.notes || '',
        is_active: partner.is_active,
      }
    })
    setPartnerDrafts(drafts)
  }, [partners])

  useEffect(() => {
    const drafts = {}
    propertyTypes.forEach((property) => {
      drafts[property.id] = {
        name: property.name,
        description: property.description || '',
        is_active: property.is_active,
      }
    })
    setPropertyDrafts(drafts)
  }, [propertyTypes])

  useEffect(() => {
    const drafts = {}
    propertySubtypes.forEach((subtype) => {
      drafts[subtype.id] = {
        property_type_id: String(subtype.property_type_id),
        name: subtype.name,
        description: subtype.description || '',
        is_active: subtype.is_active,
      }
    })
    setPropertySubtypeDrafts(drafts)
  }, [propertySubtypes])

  useEffect(() => {
    const drafts = {}
    templates.forEach((template) => {
      drafts[template.id] = {
        bank_id: template.bank_id ? String(template.bank_id) : '',
        branch_id: template.branch_id ? String(template.branch_id) : '',
        property_type_id: template.property_type_id ? String(template.property_type_id) : '',
        property_subtype_id: template.property_subtype_id ? String(template.property_subtype_id) : '',
        case_type: template.case_type || '',
        category: template.category,
        required: template.required,
        notes: template.notes || '',
      }
    })
    setTemplateDrafts(drafts)
  }, [templates])

  useEffect(() => {
    const drafts = {}
    calendarLabels.forEach((label) => {
      drafts[label.id] = {
        name: label.name,
        description: label.description || '',
        default_event_type: label.default_event_type,
        is_active: label.is_active,
      }
    })
    setCalendarLabelDrafts(drafts)
  }, [calendarLabels])

  useEffect(() => {
    if (!companyProfile) return
    setCompanyProfileForm({
      business_name: companyProfile.business_name || '',
      legal_name: companyProfile.legal_name || '',
      tagline: companyProfile.tagline || '',
      address_line1: companyProfile.address_line1 || '',
      address_line2: companyProfile.address_line2 || '',
      city: companyProfile.city || '',
      state_name: companyProfile.state_name || '',
      state_code: companyProfile.state_code || '',
      postal_code: companyProfile.postal_code || '',
      country: companyProfile.country || '',
      gstin: companyProfile.gstin || '',
      pan: companyProfile.pan || '',
      contact_email: companyProfile.contact_email || '',
      contact_phone: companyProfile.contact_phone || '',
      website: companyProfile.website || '',
      default_gst_rate: companyProfile.default_gst_rate != null ? String(companyProfile.default_gst_rate) : '18.00',
      notes: companyProfile.notes || '',
    })
  }, [companyProfile])

  const bankMap = useMemo(() => mapById(banks), [banks])
  const propertyMap = useMemo(() => mapById(propertyTypes), [propertyTypes])
  const propertySubtypeMap = useMemo(() => mapById(propertySubtypes), [propertySubtypes])
  const propertySubtypesByType = useMemo(() => {
    const map = new Map()
    propertySubtypes.forEach((subtype) => {
      const list = map.get(subtype.property_type_id) || []
      list.push(subtype)
      map.set(subtype.property_type_id, list)
    })
    return map
  }, [propertySubtypes])

  const stats = useMemo(() => ({
    banks: banks.length,
    branches: branches.length,
    clients: clients.length,
    partners: partners.length,
    property: propertyTypes.length,
    subtypes: propertySubtypes.length,
    templates: templates.length,
    calendar: calendarLabels.length,
  }), [
    banks.length,
    branches.length,
    clients.length,
    partners.length,
    propertyTypes.length,
    propertySubtypes.length,
    templates.length,
    calendarLabels.length,
  ])

  function refresh() {
    setReloadKey((k) => k + 1)
  }

  async function handleCreateBank(e) {
    e.preventDefault()
    try {
      if (!bankForm.name.trim()) {
        setError('Bank name is required')
        return
      }
      await createBank({ ...bankForm, name: bankForm.name.trim(), code: bankForm.code.trim() || null })
      setBankForm({ name: '', code: '', is_active: true })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create bank'))
    }
  }

  async function handleSaveBank(bankId) {
    const draft = bankDrafts[bankId]
    if (!draft) return
    try {
      await updateBank(bankId, { ...draft, name: draft.name.trim(), code: draft.code.trim() || null })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update bank'))
    }
  }

  async function handleCreateBranch(e) {
    e.preventDefault()
    try {
      if (!branchForm.bank_id) {
        setError('Bank is required for branch')
        return
      }
      if (!branchForm.name.trim()) {
        setError('Branch name is required')
        return
      }
      await createBranch({
        ...branchForm,
        bank_id: Number(branchForm.bank_id),
        name: branchForm.name.trim(),
        code: branchForm.code.trim() || null,
        city: branchForm.city.trim() || null,
        state: branchForm.state.trim() || null,
      })
      setBranchForm({ bank_id: '', name: '', code: '', city: '', state: '', is_active: true })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create branch'))
    }
  }

  async function handleSaveBranch(branchId) {
    const draft = branchDrafts[branchId]
    if (!draft) return
    try {
      await updateBranch(branchId, {
        ...draft,
        bank_id: Number(draft.bank_id),
        name: draft.name.trim(),
        code: draft.code.trim() || null,
        city: draft.city.trim() || null,
        state: draft.state.trim() || null,
      })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update branch'))
    }
  }

  async function handleCreateClient(e) {
    e.preventDefault()
    try {
      if (!clientForm.name.trim()) {
        setError('Client name is required')
        return
      }
      await createClient({
        ...clientForm,
        name: clientForm.name.trim(),
        client_type: clientForm.client_type.trim() || null,
        contact_name: clientForm.contact_name.trim() || null,
        contact_phone: clientForm.contact_phone.trim() || null,
        contact_email: clientForm.contact_email.trim() || null,
      })
      setClientForm({ name: '', client_type: '', contact_name: '', contact_phone: '', contact_email: '', is_active: true })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create client'))
    }
  }

  async function handleCreatePartner(e) {
    e.preventDefault()
    try {
      if (!partnerForm.display_name.trim()) {
        setError('Partner name is required')
        return
      }
      await createExternalPartner({
        display_name: partnerForm.display_name.trim(),
        legal_name: partnerForm.legal_name.trim() || null,
        contact_name: partnerForm.contact_name.trim() || null,
        email: partnerForm.email.trim() || null,
        phone: partnerForm.phone.trim() || null,
        alternate_contact_name: partnerForm.alternate_contact_name.trim() || null,
        alternate_contact_email: partnerForm.alternate_contact_email.trim() || null,
        alternate_contact_phone: partnerForm.alternate_contact_phone.trim() || null,
        city: partnerForm.city.trim() || null,
        gstin: partnerForm.gstin.trim() || null,
        billing_address: partnerForm.billing_address.trim() || null,
        billing_city: partnerForm.billing_city.trim() || null,
        billing_state: partnerForm.billing_state.trim() || null,
        billing_postal_code: partnerForm.billing_postal_code.trim() || null,
        service_lines: partnerForm.service_lines?.length ? partnerForm.service_lines : [],
        multi_floor_enabled: Boolean(partnerForm.multi_floor_enabled),
        notes: partnerForm.notes.trim() || null,
        is_active: partnerForm.is_active,
      })
      setPartnerForm({
        display_name: '',
        legal_name: '',
        contact_name: '',
        email: '',
        phone: '',
        alternate_contact_name: '',
        alternate_contact_email: '',
        alternate_contact_phone: '',
        city: '',
        gstin: '',
        billing_address: '',
        billing_city: '',
        billing_state: '',
        billing_postal_code: '',
        service_lines: [],
        multi_floor_enabled: false,
        notes: '',
        is_active: true,
      })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create partner'))
    }
  }

  async function handleSavePartner(id) {
    try {
      const draft = partnerDrafts[id]
      await updateExternalPartner(id, {
        display_name: draft.display_name.trim(),
        legal_name: draft.legal_name?.trim() || null,
        contact_name: draft.contact_name.trim() || null,
        email: draft.email.trim() || null,
        phone: draft.phone.trim() || null,
        alternate_contact_name: draft.alternate_contact_name?.trim() || null,
        alternate_contact_email: draft.alternate_contact_email?.trim() || null,
        alternate_contact_phone: draft.alternate_contact_phone?.trim() || null,
        city: draft.city.trim() || null,
        gstin: draft.gstin.trim() || null,
        billing_address: draft.billing_address.trim() || null,
        billing_city: draft.billing_city?.trim() || null,
        billing_state: draft.billing_state?.trim() || null,
        billing_postal_code: draft.billing_postal_code?.trim() || null,
        service_lines: draft.service_lines?.length ? draft.service_lines : [],
        multi_floor_enabled: Boolean(draft.multi_floor_enabled),
        notes: draft.notes?.trim() || null,
        is_active: draft.is_active,
      })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update partner'))
    }
  }

  async function handleSaveClient(clientId) {
    const draft = clientDrafts[clientId]
    if (!draft) return
    try {
      await updateClient(clientId, {
        ...draft,
        name: draft.name.trim(),
        client_type: draft.client_type.trim() || null,
        contact_name: draft.contact_name.trim() || null,
        contact_phone: draft.contact_phone.trim() || null,
        contact_email: draft.contact_email.trim() || null,
      })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update client'))
    }
  }

  async function handleCreateProperty(e) {
    e.preventDefault()
    try {
      if (!propertyForm.name.trim()) {
        setError('Property type name is required')
        return
      }
      await createPropertyType({
        ...propertyForm,
        name: propertyForm.name.trim(),
        description: propertyForm.description.trim() || null,
      })
      setPropertyForm({ name: '', description: '', is_active: true })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create property type'))
    }
  }

  async function handleSaveProperty(propertyId) {
    const draft = propertyDrafts[propertyId]
    if (!draft) return
    try {
      await updatePropertyType(propertyId, {
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim() || null,
      })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update property type'))
    }
  }

  async function handleCreatePropertySubtype(e) {
    e.preventDefault()
    try {
      if (!propertySubtypeForm.property_type_id) {
        setError('Property type is required for a subtype')
        return
      }
      if (!propertySubtypeForm.name.trim()) {
        setError('Property subtype name is required')
        return
      }
      await createPropertySubtype({
        property_type_id: Number(propertySubtypeForm.property_type_id),
        name: propertySubtypeForm.name.trim(),
        description: propertySubtypeForm.description.trim() || null,
        is_active: propertySubtypeForm.is_active,
      })
      setPropertySubtypeForm({ property_type_id: '', name: '', description: '', is_active: true })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create property subtype'))
    }
  }

  async function handleSavePropertySubtype(subtypeId) {
    const draft = propertySubtypeDrafts[subtypeId]
    if (!draft) return
    try {
      await updatePropertySubtype(subtypeId, {
        property_type_id: Number(draft.property_type_id),
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        is_active: draft.is_active,
      })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update property subtype'))
    }
  }

  async function handleCreateTemplate(e) {
    e.preventDefault()
    try {
      if (!templateForm.category.trim()) {
        setError('Document category is required')
        return
      }
      await createDocTemplate({
        ...templateForm,
        bank_id: templateForm.bank_id ? Number(templateForm.bank_id) : null,
        branch_id: templateForm.branch_id ? Number(templateForm.branch_id) : null,
        property_type_id: templateForm.property_type_id ? Number(templateForm.property_type_id) : null,
        property_subtype_id: templateForm.property_subtype_id ? Number(templateForm.property_subtype_id) : null,
        case_type: templateForm.case_type || null,
        category: templateForm.category.trim(),
        notes: templateForm.notes.trim() || null,
      })
      setTemplateForm({
        bank_id: '',
        branch_id: '',
        property_type_id: '',
        property_subtype_id: '',
        case_type: '',
        category: '',
        required: true,
        notes: '',
      })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create document template'))
    }
  }

  async function handleSaveTemplate(templateId) {
    const draft = templateDrafts[templateId]
    if (!draft) return
    try {
      await updateDocTemplate(templateId, {
        ...draft,
        bank_id: draft.bank_id ? Number(draft.bank_id) : null,
        branch_id: draft.branch_id ? Number(draft.branch_id) : null,
        property_type_id: draft.property_type_id ? Number(draft.property_type_id) : null,
        property_subtype_id: draft.property_subtype_id ? Number(draft.property_subtype_id) : null,
        case_type: draft.case_type || null,
        category: draft.category.trim(),
        notes: draft.notes.trim() || null,
      })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update document template'))
    }
  }

  async function handleCreateCalendarLabel(e) {
    e.preventDefault()
    try {
      if (!calendarLabelForm.name.trim()) {
        setError('Label name is required')
        return
      }
      await createCalendarLabel({
        name: calendarLabelForm.name.trim(),
        description: calendarLabelForm.description.trim() || null,
        default_event_type: calendarLabelForm.default_event_type,
        is_active: calendarLabelForm.is_active,
      })
      setCalendarLabelForm({ name: '', description: '', default_event_type: 'INTERNAL_MEETING', is_active: true })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to create calendar label'))
    }
  }

  async function handleSaveCalendarLabel(labelId) {
    const draft = calendarLabelDrafts[labelId]
    if (!draft) return
    try {
      await updateCalendarLabel(labelId, {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        default_event_type: draft.default_event_type,
        is_active: draft.is_active,
      })
      refresh()
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update calendar label'))
    }
  }

  async function handleSaveCompanyProfile(e) {
    e.preventDefault()
    try {
      const payload = {
        business_name: companyProfileForm.business_name.trim(),
        legal_name: companyProfileForm.legal_name.trim() || null,
        tagline: companyProfileForm.tagline.trim() || null,
        address_line1: companyProfileForm.address_line1.trim() || null,
        address_line2: companyProfileForm.address_line2.trim() || null,
        city: companyProfileForm.city.trim() || null,
        state_name: companyProfileForm.state_name.trim() || null,
        state_code: companyProfileForm.state_code.trim() || null,
        postal_code: companyProfileForm.postal_code.trim() || null,
        country: companyProfileForm.country.trim() || null,
        gstin: companyProfileForm.gstin.trim() || null,
        pan: companyProfileForm.pan.trim() || null,
        contact_email: companyProfileForm.contact_email.trim() || null,
        contact_phone: companyProfileForm.contact_phone.trim() || null,
        website: companyProfileForm.website.trim() || null,
        default_gst_rate: companyProfileForm.default_gst_rate ? Number(companyProfileForm.default_gst_rate) : null,
        notes: companyProfileForm.notes.trim() || null,
      }
      if (!payload.business_name) {
        setError('Business name is required')
        return
      }
      const updated = await updateCompanyProfile(payload)
      setCompanyProfile(updated)
    } catch (err) {
      console.error(err)
      setError(toUserMessage(err, 'Failed to update company profile'))
    }
  }

  function updateDraft(setter, id, key, value) {
    setter((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: value },
    }))
  }

  return (
    <div>
      <PageHeader
        title="Master Data"
        subtitle="Operational primitives: banks, branches, clients, property types, and document requirements."
        actions={<Badge tone="info">{stats.templates} templates</Badge>}
      />

      {error ? <div className="empty" style={{ marginBottom: '0.9rem' }}>{error}</div> : null}

      <div className="grid cols-4" style={{ marginBottom: '0.9rem' }}>
        <Stat label="Banks" value={stats.banks} help="Active bank records in master data." />
        <Stat label="Branches" value={stats.branches} help="Branches tied to bank records." />
        <Stat label="Clients" value={stats.clients} help="Non-bank client accounts." />
        <Stat label="Partners" value={stats.partners} help="External partner firms in master data." />
        <Stat label="Doc Templates" value={stats.templates} tone="info" help="Checklist templates used for document requirements." />
        <Stat label="Subtypes" value={stats.subtypes} help="Property subtypes mapped to property types." />
        <Stat label="Calendar Labels" value={stats.calendar} help="Custom labels for calendar events." />
      </div>

      <Tabs tabs={TABS} active={activeTab} onChange={setActiveTab} />

      <Card>
        <CardHeader
          title={TABS.find((tab) => tab.key === activeTab)?.label || 'Master Data'}
          subtitle="Create and refine the reference data that powers assignment workflows."
          action={<button type="button" className="secondary" onClick={refresh}>Refresh</button>}
        />

        {activeTab === 'banks' ? (
          <BanksTab
            loading={loading}
            banks={banks}
            drafts={bankDrafts}
            form={bankForm}
            setForm={setBankForm}
            onDraftChange={(id, key, value) => updateDraft(setBankDrafts, id, key, value)}
            onCreate={handleCreateBank}
            onSave={handleSaveBank}
          />
        ) : activeTab === 'branches' ? (
          <BranchesTab
            loading={loading}
            banks={banks}
            branches={branches}
            drafts={branchDrafts}
            form={branchForm}
            setForm={setBranchForm}
            onDraftChange={(id, key, value) => updateDraft(setBranchDrafts, id, key, value)}
            onCreate={handleCreateBranch}
            onSave={handleSaveBranch}
          />
        ) : activeTab === 'clients' ? (
          <ClientsTab
            loading={loading}
            clients={clients}
            drafts={clientDrafts}
            form={clientForm}
            setForm={setClientForm}
            onDraftChange={(id, key, value) => updateDraft(setClientDrafts, id, key, value)}
            onCreate={handleCreateClient}
            onSave={handleSaveClient}
          />
        ) : activeTab === 'partners' ? (
          <PartnersTab
            loading={loading}
            partners={partners}
            drafts={partnerDrafts}
            form={partnerForm}
            setForm={setPartnerForm}
            onDraftChange={(id, key, value) => updateDraft(setPartnerDrafts, id, key, value)}
            onCreate={handleCreatePartner}
            onSave={handleSavePartner}
          />
        ) : activeTab === 'property' ? (
          <PropertyTab
            loading={loading}
            propertyTypes={propertyTypes}
            drafts={propertyDrafts}
            form={propertyForm}
            setForm={setPropertyForm}
            onDraftChange={(id, key, value) => updateDraft(setPropertyDrafts, id, key, value)}
            onCreate={handleCreateProperty}
            onSave={handleSaveProperty}
          />
        ) : activeTab === 'subtypes' ? (
          <PropertySubtypesTab
            loading={loading}
            propertyTypes={propertyTypes}
            propertySubtypes={propertySubtypes}
            propertyMap={propertyMap}
            drafts={propertySubtypeDrafts}
            form={propertySubtypeForm}
            setForm={setPropertySubtypeForm}
            onDraftChange={(id, key, value) => updateDraft(setPropertySubtypeDrafts, id, key, value)}
            onCreate={handleCreatePropertySubtype}
            onSave={handleSavePropertySubtype}
          />
        ) : activeTab === 'templates' ? (
          <TemplatesTab
            loading={loading}
            banks={banks}
            branches={branches}
            propertyTypes={propertyTypes}
            propertySubtypes={propertySubtypes}
            propertySubtypesByType={propertySubtypesByType}
            bankMap={bankMap}
            propertyMap={propertyMap}
            propertySubtypeMap={propertySubtypeMap}
            templates={templates}
            drafts={templateDrafts}
            form={templateForm}
            setForm={setTemplateForm}
            onDraftChange={(id, key, value) => updateDraft(setTemplateDrafts, id, key, value)}
            onCreate={handleCreateTemplate}
            onSave={handleSaveTemplate}
          />
        ) : activeTab === 'calendar' ? (
          <CalendarLabelsTab
            loading={loading}
            labels={calendarLabels}
            drafts={calendarLabelDrafts}
            form={calendarLabelForm}
            setForm={setCalendarLabelForm}
            onDraftChange={(id, key, value) => updateDraft(setCalendarLabelDrafts, id, key, value)}
            onCreate={handleCreateCalendarLabel}
            onSave={handleSaveCalendarLabel}
            eventTypes={CALENDAR_EVENT_TYPES}
          />
        ) : activeTab === 'company' ? (
          <CompanyProfileTab
            loading={loading}
            form={companyProfileForm}
            setForm={setCompanyProfileForm}
            profile={companyProfile}
            onSave={handleSaveCompanyProfile}
          />
        ) : (
          <EmptyState>Unknown tab.</EmptyState>
        )}
      </Card>
    </div>
  )
}

function Stat({ label, value, tone, help }) {
  return (
    <div className="card tight">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="kicker">{label}</div>
        {help ? <InfoTip text={help} /> : null}
      </div>
      <div className="stat-value" style={tone ? { color: `var(--${tone})` } : undefined}>{value}</div>
    </div>
  )
}

function BanksTab({ banks, drafts, form, setForm, onDraftChange, onCreate, onSave, loading }) {
  return (
    <div className="grid">
      <form className="toolbar" onSubmit={onCreate}>
        <input
          className="grow"
          placeholder="Bank name"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
        />
        <input
          placeholder="Code"
          value={form.code}
          onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="submit">Add Bank</button>
      </form>

      {loading ? (
        <DataTable loading columns={4} rows={6} />
      ) : banks.length === 0 ? (
        <EmptyState>No banks yet.</EmptyState>
      ) : (
        <DataTable>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Code</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {banks.map((bank) => (
                <tr key={bank.id}>
                  <td>
                    <input value={drafts[bank.id]?.name || ''} onChange={(e) => onDraftChange(bank.id, 'name', e.target.value)} />
                  </td>
                  <td>
                    <input value={drafts[bank.id]?.code || ''} onChange={(e) => onDraftChange(bank.id, 'code', e.target.value)} />
                  </td>
                  <td>
                    <input type="checkbox" checked={Boolean(drafts[bank.id]?.is_active)} onChange={(e) => onDraftChange(bank.id, 'is_active', e.target.checked)} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="secondary" onClick={() => onSave(bank.id)}>Save</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
    </div>
  )
}

function BranchesTab({ banks, branches, drafts, form, setForm, onDraftChange, onCreate, onSave, loading }) {
  const bankMap = useMemo(() => mapById(banks), [banks])
  const filteredBranches = useMemo(() => {
    if (!form.bank_id) return branches
    return branches.filter((branch) => String(branch.bank_id) === String(form.bank_id))
  }, [branches, form.bank_id])

  return (
    <div className="grid">
      <form className="toolbar" onSubmit={onCreate}>
        <select value={form.bank_id} onChange={(e) => setForm((prev) => ({ ...prev, bank_id: e.target.value }))}>
          <option value="">Bank</option>
          {banks.map((bank) => (
            <option key={bank.id} value={bank.id}>{bank.name}</option>
          ))}
        </select>
        <input className="grow" placeholder="Branch name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
        <input placeholder="Code" value={form.code} onChange={(e) => setForm((prev) => ({ ...prev, code: e.target.value }))} />
        <input placeholder="City" value={form.city} onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))} />
        <input placeholder="State" value={form.state} onChange={(e) => setForm((prev) => ({ ...prev, state: e.target.value }))} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="submit">Add Branch</button>
      </form>

      {loading ? (
        <DataTable loading columns={7} rows={6} />
      ) : branches.length === 0 ? (
        <EmptyState>No branches yet.</EmptyState>
      ) : (
        <DataTable>
          <table>
            <thead>
              <tr>
                <th>Bank</th>
                <th>Name</th>
                <th>Code</th>
                <th>City</th>
                <th>State</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredBranches.map((branch) => (
                <tr key={branch.id}>
                  <td>
                    <select value={drafts[branch.id]?.bank_id || ''} onChange={(e) => onDraftChange(branch.id, 'bank_id', e.target.value)}>
                      {banks.map((bank) => (
                        <option key={bank.id} value={bank.id}>{bank.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input value={drafts[branch.id]?.name || ''} onChange={(e) => onDraftChange(branch.id, 'name', e.target.value)} />
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{bankMap.get(branch.bank_id)?.name}</div>
                  </td>
                  <td>
                    <input value={drafts[branch.id]?.code || ''} onChange={(e) => onDraftChange(branch.id, 'code', e.target.value)} />
                  </td>
                  <td>
                    <input value={drafts[branch.id]?.city || ''} onChange={(e) => onDraftChange(branch.id, 'city', e.target.value)} />
                  </td>
                  <td>
                    <input value={drafts[branch.id]?.state || ''} onChange={(e) => onDraftChange(branch.id, 'state', e.target.value)} />
                  </td>
                  <td>
                    <input type="checkbox" checked={Boolean(drafts[branch.id]?.is_active)} onChange={(e) => onDraftChange(branch.id, 'is_active', e.target.checked)} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="secondary" onClick={() => onSave(branch.id)}>Save</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
    </div>
  )
}

function ClientsTab({ clients, drafts, form, setForm, onDraftChange, onCreate, onSave, loading }) {
  return (
    <div className="grid">
      <form className="toolbar" onSubmit={onCreate}>
        <input className="grow" placeholder="Client name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
        <input placeholder="Type" value={form.client_type} onChange={(e) => setForm((prev) => ({ ...prev, client_type: e.target.value }))} />
        <input placeholder="Contact" value={form.contact_name} onChange={(e) => setForm((prev) => ({ ...prev, contact_name: e.target.value }))} />
        <input placeholder="Phone" value={form.contact_phone} onChange={(e) => setForm((prev) => ({ ...prev, contact_phone: e.target.value }))} />
        <input placeholder="Email" value={form.contact_email} onChange={(e) => setForm((prev) => ({ ...prev, contact_email: e.target.value }))} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="submit">Add Client</button>
      </form>

      {loading ? (
        <DataTable loading columns={7} rows={6} />
      ) : clients.length === 0 ? (
        <EmptyState>No clients yet.</EmptyState>
      ) : (
        <DataTable>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Contact</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <input value={drafts[client.id]?.name || ''} onChange={(e) => onDraftChange(client.id, 'name', e.target.value)} />
                  </td>
                  <td>
                    <input value={drafts[client.id]?.client_type || ''} onChange={(e) => onDraftChange(client.id, 'client_type', e.target.value)} />
                  </td>
                  <td>
                    <input value={drafts[client.id]?.contact_name || ''} onChange={(e) => onDraftChange(client.id, 'contact_name', e.target.value)} />
                  </td>
                  <td>
                    <input value={drafts[client.id]?.contact_phone || ''} onChange={(e) => onDraftChange(client.id, 'contact_phone', e.target.value)} />
                  </td>
                  <td>
                    <input value={drafts[client.id]?.contact_email || ''} onChange={(e) => onDraftChange(client.id, 'contact_email', e.target.value)} />
                  </td>
                  <td>
                    <input type="checkbox" checked={Boolean(drafts[client.id]?.is_active)} onChange={(e) => onDraftChange(client.id, 'is_active', e.target.checked)} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="secondary" onClick={() => onSave(client.id)}>Save</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
    </div>
  )
}

function PartnersTab({ partners, drafts, form, setForm, onDraftChange, onCreate, onSave, loading }) {
  const toggleFormServiceLine = (line) => {
    setForm((prev) => {
      const next = new Set(prev.service_lines || [])
      if (next.has(line)) next.delete(line)
      else next.add(line)
      return { ...prev, service_lines: Array.from(next) }
    })
  }

  const toggleDraftServiceLine = (partnerId, line) => {
    const current = drafts[partnerId]?.service_lines || []
    const next = new Set(current)
    if (next.has(line)) next.delete(line)
    else next.add(line)
    onDraftChange(partnerId, 'service_lines', Array.from(next))
  }

  return (
    <div className="grid">
      <form className="grid" onSubmit={onCreate}>
        <div className="grid cols-3">
          <input
            placeholder="Partner firm name"
            value={form.display_name}
            onChange={(e) => setForm((prev) => ({ ...prev, display_name: e.target.value }))}
          />
          <input
            placeholder="Legal name"
            value={form.legal_name}
            onChange={(e) => setForm((prev) => ({ ...prev, legal_name: e.target.value }))}
          />
          <input
            placeholder="Primary contact"
            value={form.contact_name}
            onChange={(e) => setForm((prev) => ({ ...prev, contact_name: e.target.value }))}
          />
        </div>

        <div className="grid cols-3">
          <input
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
          />
          <input
            placeholder="Phone"
            value={form.phone}
            onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
          />
          <input
            placeholder="City"
            value={form.city}
            onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))}
          />
        </div>

        <div className="grid cols-3">
          <input
            placeholder="Alternate contact"
            value={form.alternate_contact_name}
            onChange={(e) => setForm((prev) => ({ ...prev, alternate_contact_name: e.target.value }))}
          />
          <input
            placeholder="Alternate email"
            value={form.alternate_contact_email}
            onChange={(e) => setForm((prev) => ({ ...prev, alternate_contact_email: e.target.value }))}
          />
          <input
            placeholder="Alternate phone"
            value={form.alternate_contact_phone}
            onChange={(e) => setForm((prev) => ({ ...prev, alternate_contact_phone: e.target.value }))}
          />
        </div>

        <div className="grid cols-3">
          <input
            className="grow"
            placeholder="Billing address"
            value={form.billing_address}
            onChange={(e) => setForm((prev) => ({ ...prev, billing_address: e.target.value }))}
          />
          <input
            placeholder="Billing city"
            value={form.billing_city}
            onChange={(e) => setForm((prev) => ({ ...prev, billing_city: e.target.value }))}
          />
          <input
            placeholder="Billing state"
            value={form.billing_state}
            onChange={(e) => setForm((prev) => ({ ...prev, billing_state: e.target.value }))}
          />
        </div>

        <div className="grid cols-3">
          <input
            placeholder="Billing postal code"
            value={form.billing_postal_code}
            onChange={(e) => setForm((prev) => ({ ...prev, billing_postal_code: e.target.value }))}
          />
          <input
            placeholder="GSTIN"
            value={form.gstin}
            onChange={(e) => setForm((prev) => ({ ...prev, gstin: e.target.value }))}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="checkbox"
              checked={form.multi_floor_enabled}
              onChange={(e) => setForm((prev) => ({ ...prev, multi_floor_enabled: e.target.checked }))}
            />
            Allow multi-floor entry
          </label>
        </div>

        <div className="grid" style={{ gap: 6 }}>
          <div className="kicker">Service Lines</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {SERVICE_LINES.map((line) => (
              <label key={line} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  checked={(form.service_lines || []).includes(line)}
                  onChange={() => toggleFormServiceLine(line)}
                />
                <span>{line}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Internal Notes</span>
          <textarea
            rows={2}
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            placeholder="Internal oversight notes"
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="submit">Add Partner</button>
      </form>

      {loading ? (
        <DataTable loading columns={12} rows={6} />
      ) : partners.length === 0 ? (
        <EmptyState>No partners yet.</EmptyState>
      ) : (
        <DataTable>
          <table>
            <thead>
              <tr>
                <th>Firm</th>
                <th>Contact</th>
                <th>Email</th>
                <th>Phone</th>
                <th>City</th>
                <th>Billing</th>
                <th>GSTIN</th>
                <th>Service Lines</th>
                <th>Multi-floor</th>
                <th>Active</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {partners.map((partner) => {
                const draft = drafts[partner.id] || {}
                return (
                  <tr key={partner.id}>
                    <td>
                      <div className="grid" style={{ gap: 6 }}>
                        <input value={draft.display_name || ''} onChange={(e) => onDraftChange(partner.id, 'display_name', e.target.value)} />
                        <input value={draft.legal_name || ''} onChange={(e) => onDraftChange(partner.id, 'legal_name', e.target.value)} placeholder="Legal name" />
                      </div>
                    </td>
                    <td>
                      <div className="grid" style={{ gap: 6 }}>
                        <input value={draft.contact_name || ''} onChange={(e) => onDraftChange(partner.id, 'contact_name', e.target.value)} placeholder="Primary contact" />
                        <input value={draft.alternate_contact_name || ''} onChange={(e) => onDraftChange(partner.id, 'alternate_contact_name', e.target.value)} placeholder="Alternate contact" />
                      </div>
                    </td>
                    <td>
                      <div className="grid" style={{ gap: 6 }}>
                        <input value={draft.email || ''} onChange={(e) => onDraftChange(partner.id, 'email', e.target.value)} placeholder="Primary email" />
                        <input value={draft.alternate_contact_email || ''} onChange={(e) => onDraftChange(partner.id, 'alternate_contact_email', e.target.value)} placeholder="Alternate email" />
                      </div>
                    </td>
                    <td>
                      <div className="grid" style={{ gap: 6 }}>
                        <input value={draft.phone || ''} onChange={(e) => onDraftChange(partner.id, 'phone', e.target.value)} placeholder="Primary phone" />
                        <input value={draft.alternate_contact_phone || ''} onChange={(e) => onDraftChange(partner.id, 'alternate_contact_phone', e.target.value)} placeholder="Alternate phone" />
                      </div>
                    </td>
                    <td>
                      <input value={draft.city || ''} onChange={(e) => onDraftChange(partner.id, 'city', e.target.value)} />
                    </td>
                    <td>
                      <div className="grid" style={{ gap: 6 }}>
                        <input value={draft.billing_address || ''} onChange={(e) => onDraftChange(partner.id, 'billing_address', e.target.value)} placeholder="Address" />
                        <div className="grid cols-2">
                          <input value={draft.billing_city || ''} onChange={(e) => onDraftChange(partner.id, 'billing_city', e.target.value)} placeholder="City" />
                          <input value={draft.billing_state || ''} onChange={(e) => onDraftChange(partner.id, 'billing_state', e.target.value)} placeholder="State" />
                        </div>
                        <input value={draft.billing_postal_code || ''} onChange={(e) => onDraftChange(partner.id, 'billing_postal_code', e.target.value)} placeholder="Postal code" />
                      </div>
                    </td>
                    <td>
                      <input value={draft.gstin || ''} onChange={(e) => onDraftChange(partner.id, 'gstin', e.target.value)} />
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {SERVICE_LINES.map((line) => (
                          <label key={line} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="checkbox"
                              checked={(draft.service_lines || []).includes(line)}
                              onChange={() => toggleDraftServiceLine(partner.id, line)}
                            />
                            <span>{line}</span>
                          </label>
                        ))}
                      </div>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(draft.multi_floor_enabled)}
                        onChange={(e) => onDraftChange(partner.id, 'multi_floor_enabled', e.target.checked)}
                      />
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={Boolean(draft.is_active)}
                        onChange={(e) => onDraftChange(partner.id, 'is_active', e.target.checked)}
                      />
                    </td>
                    <td>
                      <textarea
                        rows={2}
                        value={draft.notes || ''}
                        onChange={(e) => onDraftChange(partner.id, 'notes', e.target.value)}
                      />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="secondary" onClick={() => onSave(partner.id)}>Save</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </DataTable>
      )}
    </div>
  )
}

function PropertyTab({ propertyTypes, drafts, form, setForm, onDraftChange, onCreate, onSave, loading }) {
  return (
    <div className="grid">
      <form className="toolbar" onSubmit={onCreate}>
        <input className="grow" placeholder="Property type name" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
        <input className="grow" placeholder="Description" value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="submit">Add Type</button>
      </form>

      {loading ? (
        <DataTable loading columns={4} rows={6} />
      ) : propertyTypes.length === 0 ? (
        <EmptyState>No property types yet.</EmptyState>
      ) : (
        <DataTable>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {propertyTypes.map((property) => (
                <tr key={property.id}>
                  <td>
                    <input value={drafts[property.id]?.name || ''} onChange={(e) => onDraftChange(property.id, 'name', e.target.value)} />
                  </td>
                  <td>
                    <input value={drafts[property.id]?.description || ''} onChange={(e) => onDraftChange(property.id, 'description', e.target.value)} />
                  </td>
                  <td>
                    <input type="checkbox" checked={Boolean(drafts[property.id]?.is_active)} onChange={(e) => onDraftChange(property.id, 'is_active', e.target.checked)} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="secondary" onClick={() => onSave(property.id)}>Save</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
    </div>
  )
}

function PropertySubtypesTab({
  propertyTypes,
  propertySubtypes,
  propertyMap,
  drafts,
  form,
  setForm,
  onDraftChange,
  onCreate,
  onSave,
  loading,
}) {
  return (
    <div className="grid">
      <form className="toolbar" onSubmit={onCreate}>
        <select value={form.property_type_id} onChange={(e) => setForm((prev) => ({ ...prev, property_type_id: e.target.value }))}>
          <option value="">Property type</option>
          {propertyTypes.map((property) => (
            <option key={property.id} value={property.id}>
              {property.name}
            </option>
          ))}
        </select>
        <input
          className="grow"
          placeholder="Subtype name"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
        />
        <input
          className="grow"
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="submit">Add Subtype</button>
      </form>

      {loading ? (
        <DataTable loading columns={5} rows={6} />
      ) : propertySubtypes.length === 0 ? (
        <EmptyState>No property subtypes yet.</EmptyState>
      ) : (
        <DataTable>
          <table>
            <thead>
              <tr>
                <th>Property Type</th>
                <th>Name</th>
                <th>Description</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {propertySubtypes.map((subtype) => (
                <tr key={subtype.id}>
                  <td>
                    <select
                      value={drafts[subtype.id]?.property_type_id || ''}
                      onChange={(e) => onDraftChange(subtype.id, 'property_type_id', e.target.value)}
                    >
                      {propertyTypes.map((property) => (
                        <option key={property.id} value={property.id}>
                          {property.name}
                        </option>
                      ))}
                    </select>
                    <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {propertyMap.get(subtype.property_type_id)?.name}
                    </div>
                  </td>
                  <td>
                    <input value={drafts[subtype.id]?.name || ''} onChange={(e) => onDraftChange(subtype.id, 'name', e.target.value)} />
                  </td>
                  <td>
                    <input value={drafts[subtype.id]?.description || ''} onChange={(e) => onDraftChange(subtype.id, 'description', e.target.value)} />
                  </td>
                  <td>
                    <input type="checkbox" checked={Boolean(drafts[subtype.id]?.is_active)} onChange={(e) => onDraftChange(subtype.id, 'is_active', e.target.checked)} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="secondary" onClick={() => onSave(subtype.id)}>Save</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      )}
    </div>
  )
}

function TemplatesTab({
  banks,
  branches,
  propertyTypes,
  propertySubtypes,
  propertySubtypesByType,
  bankMap,
  propertyMap,
  propertySubtypeMap,
  templates,
  drafts,
  form,
  setForm,
  onDraftChange,
  onCreate,
  onSave,
}) {
  const branchMap = useMemo(() => mapById(branches), [branches])
  const filteredBranches = useMemo(() => {
    if (!form.bank_id) return branches
    return branches.filter((branch) => String(branch.bank_id) === String(form.bank_id))
  }, [branches, form.bank_id])
  const formSubtypes = useMemo(() => {
    if (!form.property_type_id) return propertySubtypes
    const typeId = Number(form.property_type_id)
    return propertySubtypesByType.get(typeId) || []
  }, [form.property_type_id, propertySubtypes, propertySubtypesByType])

  return (
    <div className="grid">
      <form className="toolbar" onSubmit={onCreate}>
        <select value={form.bank_id} onChange={(e) => setForm((prev) => ({ ...prev, bank_id: e.target.value, branch_id: '' }))}>
          <option value="">Bank (optional)</option>
          {banks.map((bank) => (
            <option key={bank.id} value={bank.id}>{bank.name}</option>
          ))}
        </select>
        <select value={form.branch_id} onChange={(e) => setForm((prev) => ({ ...prev, branch_id: e.target.value }))}>
          <option value="">Branch (optional)</option>
          {filteredBranches.map((branch) => (
            <option key={branch.id} value={branch.id}>{branch.name}</option>
          ))}
        </select>
        <select
          value={form.property_type_id}
          onChange={(e) => setForm((prev) => ({ ...prev, property_type_id: e.target.value, property_subtype_id: '' }))}
        >
          <option value="">Property (optional)</option>
          {propertyTypes.map((property) => (
            <option key={property.id} value={property.id}>{property.name}</option>
          ))}
        </select>
        <select
          value={form.property_subtype_id}
          onChange={(e) => {
            const subtypeId = e.target.value
            const subtype = subtypeId ? propertySubtypeMap.get(Number(subtypeId)) : null
            setForm((prev) => ({
              ...prev,
              property_subtype_id: subtypeId,
              property_type_id: subtype ? String(subtype.property_type_id) : prev.property_type_id,
            }))
          }}
        >
          <option value="">Subtype (optional)</option>
          {formSubtypes.map((subtype) => (
            <option key={subtype.id} value={subtype.id}>
              {subtype.name}
            </option>
          ))}
        </select>
        <select value={form.case_type} onChange={(e) => setForm((prev) => ({ ...prev, case_type: e.target.value }))}>
          <option value="">Case Type (optional)</option>
          {CASE_TYPES.map((type) => (
            <option key={type} value={type}>{titleCase(type)}</option>
          ))}
        </select>
        <input className="grow" placeholder="Category (e.g., EC, Sale Deed)" value={form.category} onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={form.required} onChange={(e) => setForm((prev) => ({ ...prev, required: e.target.checked }))} />
          Required
        </label>
        <button type="submit">Add Template</button>
      </form>

      <label className="grid" style={{ gap: 6 }}>
        <span className="kicker">Notes for new template</span>
        <textarea rows={2} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
      </label>

      {templates.length === 0 ? (
        <EmptyState>No document templates yet.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Scope</th>
                <th>Category</th>
                <th>Required</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const draft = drafts[template.id] || {}
                const rowTypeId = draft.property_type_id ? Number(draft.property_type_id) : null
                const rowSubtypes = rowTypeId ? propertySubtypesByType.get(rowTypeId) || [] : propertySubtypes
                const displayTypeId = draft.property_type_id ? Number(draft.property_type_id) : template.property_type_id
                const displaySubtypeId = draft.property_subtype_id ? Number(draft.property_subtype_id) : template.property_subtype_id
                const subtypeDisplay = propertySubtypeMap.get(displaySubtypeId)?.name || 'All subtypes'
                return (
                  <tr key={template.id}>
                    <td>
                      <div className="grid" style={{ gap: 6 }}>
                        <select value={draft.bank_id || ''} onChange={(e) => onDraftChange(template.id, 'bank_id', e.target.value)}>
                          <option value="">Any bank</option>
                          {banks.map((bank) => (
                            <option key={bank.id} value={bank.id}>{bank.name}</option>
                          ))}
                        </select>
                        <select
                          value={draft.branch_id || ''}
                          onChange={(e) => onDraftChange(template.id, 'branch_id', e.target.value)}
                        >
                          <option value="">Any branch</option>
                          {branches
                            .filter((branch) => {
                              const bankId = draft.bank_id
                              return bankId ? String(branch.bank_id) === String(bankId) : true
                            })
                            .map((branch) => (
                              <option key={branch.id} value={branch.id}>{branch.name}</option>
                            ))}
                        </select>
                        <select
                          value={draft.property_type_id || ''}
                          onChange={(e) => {
                            onDraftChange(template.id, 'property_type_id', e.target.value)
                            onDraftChange(template.id, 'property_subtype_id', '')
                          }}
                        >
                          <option value="">Any property</option>
                          {propertyTypes.map((property) => (
                            <option key={property.id} value={property.id}>{property.name}</option>
                          ))}
                        </select>
                        <select
                          value={draft.property_subtype_id || ''}
                          onChange={(e) => {
                            const subtypeId = e.target.value
                            const subtype = subtypeId ? propertySubtypeMap.get(Number(subtypeId)) : null
                            onDraftChange(template.id, 'property_subtype_id', subtypeId)
                            if (subtype) onDraftChange(template.id, 'property_type_id', String(subtype.property_type_id))
                          }}
                        >
                          <option value="">Any subtype</option>
                          {rowSubtypes.map((subtype) => (
                            <option key={subtype.id} value={subtype.id}>
                              {subtype.name}
                            </option>
                          ))}
                        </select>
                        <select value={draft.case_type || ''} onChange={(e) => onDraftChange(template.id, 'case_type', e.target.value)}>
                          <option value="">Any case</option>
                          {CASE_TYPES.map((type) => (
                            <option key={type} value={type}>{titleCase(type)}</option>
                          ))}
                        </select>
                        <div className="muted" style={{ fontSize: 12 }}>
                          {bankMap.get(template.bank_id)?.name || 'All banks'} · {branchMap.get(template.branch_id)?.name || 'All branches'}
                          {' · '}
                          {propertyMap.get(displayTypeId)?.name || 'All property types'}
                          {' · '}
                          {subtypeDisplay}
                        </div>
                      </div>
                    </td>
                    <td>
                      <input value={draft.category || ''} onChange={(e) => onDraftChange(template.id, 'category', e.target.value)} />
                    </td>
                    <td>
                      <input type="checkbox" checked={Boolean(draft.required)} onChange={(e) => onDraftChange(template.id, 'required', e.target.checked)} />
                    </td>
                    <td>
                      <textarea rows={2} value={draft.notes || ''} onChange={(e) => onDraftChange(template.id, 'notes', e.target.value)} />
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="secondary" onClick={() => onSave(template.id)}>Save</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CalendarLabelsTab({ labels, drafts, form, setForm, onDraftChange, onCreate, onSave, eventTypes }) {
  return (
    <div className="grid">
      <form className="toolbar" onSubmit={onCreate}>
        <input
          className="grow"
          placeholder="Label name (e.g., Company Holiday)"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
        />
        <select value={form.default_event_type} onChange={(e) => setForm((prev) => ({ ...prev, default_event_type: e.target.value }))}>
          {eventTypes.map((type) => (
            <option key={type} value={type}>
              {titleCase(type)}
            </option>
          ))}
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))} />
          Active
        </label>
        <button type="submit">Add Label</button>
      </form>

      <label className="grid" style={{ gap: 6 }}>
        <span className="kicker">Description</span>
        <textarea rows={2} value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} />
      </label>

      {labels.length === 0 ? (
        <EmptyState>No calendar labels yet.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Default Type</th>
                <th>Active</th>
                <th>Description</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {labels.map((label) => (
                <tr key={label.id}>
                  <td>
                    <input value={drafts[label.id]?.name || ''} onChange={(e) => onDraftChange(label.id, 'name', e.target.value)} />
                  </td>
                  <td>
                    <select value={drafts[label.id]?.default_event_type || 'INTERNAL_MEETING'} onChange={(e) => onDraftChange(label.id, 'default_event_type', e.target.value)}>
                      {eventTypes.map((type) => (
                        <option key={type} value={type}>
                          {titleCase(type)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input type="checkbox" checked={Boolean(drafts[label.id]?.is_active)} onChange={(e) => onDraftChange(label.id, 'is_active', e.target.checked)} />
                  </td>
                  <td>
                    <textarea rows={2} value={drafts[label.id]?.description || ''} onChange={(e) => onDraftChange(label.id, 'description', e.target.value)} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="secondary" onClick={() => onSave(label.id)}>Save</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function CompanyProfileTab({ form, setForm, profile, onSave }) {
  return (
    <form className="grid" onSubmit={onSave}>
      <div className="grid cols-3">
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Business Name</span>
          <input value={form.business_name} onChange={(e) => setForm((prev) => ({ ...prev, business_name: e.target.value }))} required />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Legal Name</span>
          <input value={form.legal_name} onChange={(e) => setForm((prev) => ({ ...prev, legal_name: e.target.value }))} />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Default GST %</span>
          <input type="number" step="0.01" value={form.default_gst_rate} onChange={(e) => setForm((prev) => ({ ...prev, default_gst_rate: e.target.value }))} />
        </label>
      </div>

      <div className="grid cols-3">
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">GSTIN</span>
          <input value={form.gstin} onChange={(e) => setForm((prev) => ({ ...prev, gstin: e.target.value }))} />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">PAN</span>
          <input value={form.pan} onChange={(e) => setForm((prev) => ({ ...prev, pan: e.target.value }))} />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Tagline</span>
          <input value={form.tagline} onChange={(e) => setForm((prev) => ({ ...prev, tagline: e.target.value }))} />
        </label>
      </div>

      <div className="grid cols-3">
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Address Line 1</span>
          <input value={form.address_line1} onChange={(e) => setForm((prev) => ({ ...prev, address_line1: e.target.value }))} />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Address Line 2</span>
          <input value={form.address_line2} onChange={(e) => setForm((prev) => ({ ...prev, address_line2: e.target.value }))} />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">City</span>
          <input value={form.city} onChange={(e) => setForm((prev) => ({ ...prev, city: e.target.value }))} />
        </label>
      </div>

      <div className="grid cols-4">
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">State</span>
          <input value={form.state_name} onChange={(e) => setForm((prev) => ({ ...prev, state_name: e.target.value }))} />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">State Code</span>
          <input value={form.state_code} onChange={(e) => setForm((prev) => ({ ...prev, state_code: e.target.value }))} />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Postal Code</span>
          <input value={form.postal_code} onChange={(e) => setForm((prev) => ({ ...prev, postal_code: e.target.value }))} />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Country</span>
          <input value={form.country} onChange={(e) => setForm((prev) => ({ ...prev, country: e.target.value }))} />
        </label>
      </div>

      <div className="grid cols-3">
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Contact Email</span>
          <input value={form.contact_email} onChange={(e) => setForm((prev) => ({ ...prev, contact_email: e.target.value }))} />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Contact Phone</span>
          <input value={form.contact_phone} onChange={(e) => setForm((prev) => ({ ...prev, contact_phone: e.target.value }))} />
        </label>
        <label className="grid" style={{ gap: 6 }}>
          <span className="kicker">Website</span>
          <input value={form.website} onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))} />
        </label>
      </div>

      <label className="grid" style={{ gap: 6 }}>
        <span className="kicker">Notes</span>
        <textarea rows={3} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div className="muted" style={{ fontSize: 12 }}>
          {profile ? `Profile ID: ${profile.id}` : 'No company profile yet.'}
        </div>
        <button type="submit">Save Company Profile</button>
      </div>
    </form>
  )
}
