import React, { createContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../auth/AuthContext'
import { canSeeAdmin, hasCapability, isPartner } from '../../utils/rbac'
import { getDemoTutorialFlow, getDemoTutorialFlowSummaries, isDemoTutorialFlowId } from './demoTutorialSteps'
import {
  clearLegacyTutorialStorage,
  clearPreferredTutorialFlow,
  clearTutorialDismissed,
  clearTutorialState,
  loadPreferredTutorialFlow,
  loadTutorialDismissed,
  loadTutorialState,
  savePreferredTutorialFlow,
  saveTutorialDismissed,
  saveTutorialState,
} from './tutorialStorage'
import { getTutorialPolicy } from './tutorialPolicy'

export const DemoTutorialContext = createContext(null)

function isPublicRoute(pathname) {
  return pathname === '/login'
    || pathname.startsWith('/partner/request-access')
    || pathname.startsWith('/partner/verify')
    || pathname.startsWith('/invite/accept')
}

function getTutorialSurface(pathname) {
  return pathname.startsWith('/m/') ? 'mobile' : 'desktop'
}

function getTutorialHomeRoute(user, capabilities, surface) {
  if (surface === 'mobile') return '/m/home'
  if (!user) return '/login'
  if (isPartner(user)) return '/partner'
  if (canSeeAdmin(capabilities) || hasCapability(capabilities, 'approve_actions') || hasCapability(capabilities, 'view_invoices')) {
    return '/admin/dashboard'
  }
  return '/account'
}

function buildTutorialScope(user, surface) {
  const identity = user?.id
    ? `user-${user.id}`
    : user?.email
      ? `email-${String(user.email).trim().toLowerCase()}`
      : 'anonymous'
  return `${surface}:${identity}`
}

function matchesStep(pathname, step) {
  if (!step) return false
  if (step.routePattern) {
    try {
      return new RegExp(step.routePattern).test(pathname)
    } catch {
      return false
    }
  }
  return pathname === step.route
}

function resolveRouteFromSelector(selector) {
  if (!selector || typeof document === 'undefined') return null
  const element = document.querySelector(selector)
  if (!element) return null
  const explicitRoute = element.getAttribute('data-tour-route')
  if (explicitRoute) return explicitRoute
  const nestedRoute = element.querySelector('[data-tour-route]')?.getAttribute('data-tour-route')
  return nestedRoute || null
}

function resolveStepRoute(step, pathname) {
  if (!step?.route) return null
  if (!step.route.includes(':')) return step.route

  let resolvedRoute = step.route
  const assignmentMatch = pathname.match(/\/assignments\/([^/]+)/)
  if (assignmentMatch) {
    resolvedRoute = resolvedRoute.replace(':id', assignmentMatch[1])
  }

  if (!resolvedRoute.includes(':')) return resolvedRoute

  const selectorRoute = resolveRouteFromSelector(step.routeSourceTarget)
  if (selectorRoute) return selectorRoute

  return null
}

function defaultFlowIdForUser(user, capabilities) {
  if (!user) return 'associate'
  if (isPartner(user)) return 'associate'
  if (canSeeAdmin(capabilities) || hasCapability(capabilities, 'approve_actions') || hasCapability(capabilities, 'view_invoices')) {
    return 'admin'
  }
  return 'field'
}

const DEFAULT_STATE = {
  activeFlowId: null,
  currentStepIndex: 0,
  completedStepIds: [],
  completedFlowIds: [],
  startedAt: null,
  finishedAt: null,
  lastPathname: null,
}

export function DemoTutorialProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, capabilities } = useAuth()
  const policy = useMemo(() => getTutorialPolicy(), [])
  const publicRoute = isPublicRoute(location.pathname)
  const surface = useMemo(() => getTutorialSurface(location.pathname), [location.pathname])
  const storageScope = useMemo(() => buildTutorialScope(user, surface), [surface, user])
  const defaultFlowId = useMemo(() => defaultFlowIdForUser(user, capabilities), [capabilities, user])
  const tutorialHomeRoute = useMemo(
    () => getTutorialHomeRoute(user, capabilities, surface),
    [capabilities, surface, user],
  )

  const isEnabled = Boolean(policy) && Boolean(user) && !publicRoute
  const routeIsTutorialHome = location.pathname === tutorialHomeRoute

  const hydratedScopeRef = useRef(null)
  const [hydrated, setHydrated] = useState(false)
  const [state, setState] = useState(DEFAULT_STATE)
  const [dismissed, setDismissed] = useState(false)
  const [coachmarkOpen, setCoachmarkOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedFlowId, setSelectedFlowId] = useState(null)

  const flowSummaries = useMemo(() => getDemoTutorialFlowSummaries({ surface }), [surface])
  const activeFlow = useMemo(
    () => getDemoTutorialFlow(state.activeFlowId, { surface }),
    [state.activeFlowId, surface],
  )
  const steps = activeFlow?.steps || []
  const currentStep = steps[state.currentStepIndex] || null
  const routeReady = matchesStep(location.pathname, currentStep)
  const activeFlowCompleted = Boolean(activeFlow && state.completedFlowIds.includes(activeFlow.id))
  const hasTutorialState = Boolean(dismissed || state.startedAt || state.completedFlowIds.length)
  const shouldShowMissionPanel = isEnabled && !modalOpen && (
    policy.shouldShowMissionPanelByDefault
    || (!dismissed && Boolean(state.startedAt || (activeFlow && !activeFlowCompleted)))
  )
  const shouldShowLauncher = isEnabled && !modalOpen && !shouldShowMissionPanel && !policy.shouldAutoStart

  useEffect(() => {
    if (!user) {
      hydratedScopeRef.current = null
      setHydrated(false)
      setState(DEFAULT_STATE)
      setDismissed(false)
      setCoachmarkOpen(false)
      setModalOpen(false)
      setSelectedFlowId(null)
      return
    }

    if (hydratedScopeRef.current === storageScope) return

    clearLegacyTutorialStorage()
    hydratedScopeRef.current = storageScope

    const storedState = loadTutorialState(storageScope)
    const storedDismissed = loadTutorialDismissed(storageScope)
    const storedFlowId = loadPreferredTutorialFlow(storageScope)

    setState({
      ...DEFAULT_STATE,
      ...(storedState && typeof storedState === 'object' ? storedState : {}),
    })
    setDismissed(storedDismissed)
    setCoachmarkOpen(false)
    setModalOpen(false)
    setSelectedFlowId(isDemoTutorialFlowId(storedFlowId) ? storedFlowId : defaultFlowId)
    setHydrated(true)
  }, [defaultFlowId, storageScope, user])

  useEffect(() => {
    if (!hydrated || !user) return
    saveTutorialState(storageScope, state)
  }, [hydrated, state, storageScope, user])

  useEffect(() => {
    if (!hydrated || !user) return
    saveTutorialDismissed(storageScope, dismissed)
  }, [dismissed, hydrated, storageScope, user])

  useEffect(() => {
    if (!hydrated || !user || !selectedFlowId) return
    savePreferredTutorialFlow(storageScope, selectedFlowId)
  }, [hydrated, selectedFlowId, storageScope, user])

  useEffect(() => {
    if (!user) return
    setSelectedFlowId((current) => (isDemoTutorialFlowId(current) ? current : defaultFlowId))
  }, [defaultFlowId, user])

  useEffect(() => {
    if (!hydrated) return
    if (!isEnabled) {
      setModalOpen(false)
      setCoachmarkOpen(false)
      return
    }

    const preferredCompleted = state.completedFlowIds.includes(defaultFlowId)
    const hasActiveFlow = Boolean(state.activeFlowId)
    const shouldOpenPrompt = routeIsTutorialHome
      && !dismissed
      && !preferredCompleted
      && !hasActiveFlow
      && (policy.shouldAutoStart || policy.shouldShowFirstLoginPrompt)

    if (shouldOpenPrompt) {
      setModalOpen(true)
    }
  }, [
    defaultFlowId,
    dismissed,
    hydrated,
    isEnabled,
    policy.shouldAutoStart,
    policy.shouldShowFirstLoginPrompt,
    routeIsTutorialHome,
    state.activeFlowId,
    state.completedFlowIds,
  ])

  useEffect(() => {
    if (!isEnabled || !activeFlow) return
    const matchingIndexes = activeFlow.steps
      .map((step, index) => (step.autoAdvanceOnRoute && matchesStep(location.pathname, step) ? index : -1))
      .filter((index) => index >= 0)

    if (!matchingIndexes.length) return
    const highestMatch = Math.max(...matchingIndexes)
    if (highestMatch <= state.currentStepIndex) return

    setState((prev) => ({
      ...prev,
      currentStepIndex: highestMatch,
      completedStepIds: Array.from(new Set([
        ...prev.completedStepIds,
        ...activeFlow.steps.slice(0, highestMatch).map((step) => step.id),
      ])),
      lastPathname: location.pathname,
    }))
  }, [activeFlow, isEnabled, location.pathname, state.currentStepIndex])

  useEffect(() => {
    if (!isEnabled) return
    setState((prev) => (
      prev.lastPathname === location.pathname ? prev : { ...prev, lastPathname: location.pathname }
    ))
  }, [isEnabled, location.pathname])

  const progress = useMemo(() => {
    if (!activeFlow) return { completed: 0, total: 0, percent: 0 }
    const activeStepIds = new Set(activeFlow.steps.map((step) => step.id))
    const completed = new Set(state.completedStepIds.filter((stepId) => activeStepIds.has(stepId)))
    if (currentStep && !activeFlowCompleted) completed.add(currentStep.id)
    const total = activeFlow.steps.length
    const count = Math.min(total, completed.size)
    return {
      completed: count,
      total,
      percent: total ? Math.round((count / total) * 100) : 0,
    }
  }, [activeFlow, activeFlowCompleted, currentStep, state.completedStepIds])

  function persistFlowSelection(flowId) {
    const nextFlowId = isDemoTutorialFlowId(flowId) ? flowId : defaultFlowId
    setSelectedFlowId(nextFlowId)
    savePreferredTutorialFlow(storageScope, nextFlowId)
    return nextFlowId
  }

  function navigateToStep(step) {
    const resolvedRoute = resolveStepRoute(step, location.pathname)
    if (!resolvedRoute) return
    if (!matchesStep(location.pathname, step)) {
      navigate(resolvedRoute)
    }
  }

  function openTutorialModal(flowId = null) {
    if (flowId) persistFlowSelection(flowId)
    setCoachmarkOpen(false)
    setModalOpen(true)
  }

  function startFlow(flowId = selectedFlowId || defaultFlowId) {
    const nextFlowId = persistFlowSelection(flowId)
    const flow = getDemoTutorialFlow(nextFlowId, { surface })
    if (!flow) return

    saveTutorialDismissed(storageScope, false)
    setDismissed(false)
    setModalOpen(false)
    setCoachmarkOpen(true)
    setState((prev) => ({
      ...prev,
      activeFlowId: flow.id,
      currentStepIndex: 0,
      completedStepIds: [],
      completedFlowIds: prev.completedFlowIds.filter((completedFlowId) => completedFlowId !== flow.id),
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }))
    navigateToStep(flow.steps[0])
  }

  function resumeFlow() {
    if (!activeFlow || !currentStep || activeFlowCompleted) {
      startFlow(activeFlow?.id || selectedFlowId || defaultFlowId)
      return
    }
    saveTutorialDismissed(storageScope, false)
    setDismissed(false)
    setCoachmarkOpen(true)
    navigateToStep(currentStep)
  }

  function closeCoachmark() {
    setCoachmarkOpen(false)
  }

  function dismissTutorial() {
    saveTutorialDismissed(storageScope, true)
    setDismissed(true)
    setModalOpen(false)
    setCoachmarkOpen(false)
  }

  function resetTutorial() {
    clearTutorialState(storageScope)
    clearTutorialDismissed(storageScope)
    clearPreferredTutorialFlow(storageScope)
    setDismissed(false)
    setCoachmarkOpen(false)
    setModalOpen(routeIsTutorialHome && (policy.shouldAutoStart || policy.shouldShowFirstLoginPrompt))
    setSelectedFlowId(defaultFlowId)
    setState(DEFAULT_STATE)
  }

  function goToStep(indexOrId) {
    if (!activeFlow) return
    const nextIndex = typeof indexOrId === 'number'
      ? indexOrId
      : activeFlow.steps.findIndex((step) => step.id === indexOrId)
    if (nextIndex < 0 || nextIndex >= activeFlow.steps.length) return

    const nextStep = activeFlow.steps[nextIndex]
    saveTutorialDismissed(storageScope, false)
    setDismissed(false)
    setState((prev) => ({
      ...prev,
      currentStepIndex: nextIndex,
      completedStepIds: Array.from(new Set([
        ...prev.completedStepIds,
        ...activeFlow.steps.slice(0, nextIndex).map((step) => step.id),
      ])),
      finishedAt: null,
    }))
    setCoachmarkOpen(true)
    navigateToStep(nextStep)
  }

  function previousStep() {
    if (!activeFlow) return
    const nextIndex = Math.max(0, state.currentStepIndex - 1)
    goToStep(nextIndex)
  }

  function finishFlow() {
    if (!activeFlow) return
    saveTutorialDismissed(storageScope, true)
    setCoachmarkOpen(false)
    setDismissed(true)
    setState((prev) => ({
      ...prev,
      completedStepIds: Array.from(new Set([
        ...prev.completedStepIds,
        ...activeFlow.steps.map((step) => step.id),
      ])),
      completedFlowIds: Array.from(new Set([...prev.completedFlowIds, activeFlow.id])),
      finishedAt: new Date().toISOString(),
    }))
  }

  function nextStep() {
    if (!activeFlow || !currentStep) return

    const completedIds = Array.from(new Set([...state.completedStepIds, currentStep.id]))
    const nextIndex = state.currentStepIndex + 1

    if (nextIndex >= activeFlow.steps.length) {
      setState((prev) => ({ ...prev, completedStepIds: completedIds }))
      finishFlow()
      return
    }

    const nextStepDef = activeFlow.steps[nextIndex]
    saveTutorialDismissed(storageScope, false)
    setDismissed(false)
    setState((prev) => ({
      ...prev,
      completedStepIds: completedIds,
      currentStepIndex: nextIndex,
      finishedAt: null,
    }))
    setCoachmarkOpen(true)

    navigateToStep(nextStepDef)
  }

  const contextValue = useMemo(() => ({
    isEnabled,
    policy,
    preferredFlowId: selectedFlowId || defaultFlowId,
    selectedFlowId: selectedFlowId || defaultFlowId,
    setSelectedFlowId: persistFlowSelection,
    flowSummaries,
    activeFlow,
    currentStep,
    currentStepIndex: state.currentStepIndex,
    progress,
    dismissed,
    isModalOpen: modalOpen,
    isCoachmarkOpen: coachmarkOpen && Boolean(activeFlow && currentStep) && !activeFlowCompleted,
    routeReady,
    shouldShowMissionPanel,
    shouldShowLauncher,
    hasTutorialState,
    helpPath: location.pathname.startsWith('/m/') ? policy.helpPaths.mobile : policy.helpPaths.desktop,
    helpLabel: policy.helpLabel,
    openTutorialModal,
    startFlow,
    resumeFlow,
    closeCoachmark,
    dismissTutorial,
    resetTutorial,
    nextStep,
    previousStep,
    goToStep,
  }), [
    activeFlow,
    activeFlowCompleted,
    coachmarkOpen,
    currentStep,
    defaultFlowId,
    dismissed,
    flowSummaries,
    hasTutorialState,
    isEnabled,
    location.pathname,
    modalOpen,
    policy,
    progress,
    routeReady,
    selectedFlowId,
    shouldShowLauncher,
    shouldShowMissionPanel,
    state.currentStepIndex,
  ])

  return (
    <DemoTutorialContext.Provider value={contextValue}>
      {children}
    </DemoTutorialContext.Provider>
  )
}
