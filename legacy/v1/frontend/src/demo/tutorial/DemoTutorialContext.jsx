import React, { createContext, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useAuth } from '../../auth/AuthContext'
import { canSeeAdmin, hasCapability, isPartner } from '../../utils/rbac'
import { DEMO_TUTORIAL_FLOWS, getDemoTutorialFlow, getDemoTutorialFlowSummaries } from './demoTutorialSteps'
import {
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
  const isEnabled = Boolean(policy) && Boolean(user) && !publicRoute

  const bootstrappedRef = useRef(false)
  const [hydrated, setHydrated] = useState(false)
  const [state, setState] = useState(DEFAULT_STATE)
  const [dismissed, setDismissed] = useState(false)
  const [coachmarkOpen, setCoachmarkOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedFlowId, setSelectedFlowId] = useState(null)

  const preferredFlowId = useMemo(() => {
    const saved = loadPreferredTutorialFlow()
    if (saved && DEMO_TUTORIAL_FLOWS[saved]) return saved
    return defaultFlowIdForUser(user, capabilities)
  }, [user, capabilities])

  const flowSummaries = useMemo(() => getDemoTutorialFlowSummaries(), [])
  const activeFlow = useMemo(() => getDemoTutorialFlow(state.activeFlowId), [state.activeFlowId])
  const steps = activeFlow?.steps || []
  const currentStep = steps[state.currentStepIndex] || null
  const routeReady = matchesStep(location.pathname, currentStep)
  const activeFlowCompleted = Boolean(activeFlow && state.completedFlowIds.includes(activeFlow.id))
  const hasTutorialState = Boolean(dismissed || state.startedAt || state.completedFlowIds.length)
  const shouldShowMissionPanel = isEnabled && (
    policy.shouldShowMissionPanelByDefault
    || (!dismissed && Boolean(state.startedAt || (activeFlow && !activeFlowCompleted)))
  )
  const shouldShowLauncher = isEnabled && !shouldShowMissionPanel

  useEffect(() => {
    if (bootstrappedRef.current) return
    bootstrappedRef.current = true
    const storedState = loadTutorialState()
    const storedDismissed = loadTutorialDismissed()
    if (storedState && typeof storedState === 'object') {
      setState((prev) => ({ ...prev, ...storedState }))
    }
    setDismissed(storedDismissed)
    setSelectedFlowId(loadPreferredTutorialFlow() || null)
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    saveTutorialState(state)
  }, [hydrated, state])

  useEffect(() => {
    if (!hydrated) return
    saveTutorialDismissed(dismissed)
  }, [dismissed, hydrated])

  useEffect(() => {
    if (!hydrated || !selectedFlowId) return
    savePreferredTutorialFlow(selectedFlowId)
  }, [hydrated, selectedFlowId])

  useEffect(() => {
    if (!user) return
    setSelectedFlowId((current) => current || preferredFlowId)
  }, [preferredFlowId, user])

  useEffect(() => {
    if (!isEnabled) {
      setModalOpen(false)
      setCoachmarkOpen(false)
      return
    }

    const preferredCompleted = state.completedFlowIds.includes(preferredFlowId)
    const hasActiveFlow = Boolean(state.activeFlowId)
    const shouldOpenPrompt = !dismissed
      && !preferredCompleted
      && !hasActiveFlow
      && (policy.shouldAutoStart || policy.shouldShowFirstLoginPrompt)

    if (shouldOpenPrompt) {
      setModalOpen(true)
    }
  }, [dismissed, isEnabled, policy.shouldAutoStart, policy.shouldShowFirstLoginPrompt, preferredFlowId, state.activeFlowId, state.completedFlowIds])

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
    if (!flowId || !DEMO_TUTORIAL_FLOWS[flowId]) return preferredFlowId
    setSelectedFlowId(flowId)
    return flowId
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

  function startFlow(flowId = selectedFlowId || preferredFlowId) {
    const nextFlowId = persistFlowSelection(flowId)
    const flow = getDemoTutorialFlow(nextFlowId)
    if (!flow) return

    setDismissed(false)
    setModalOpen(false)
    setCoachmarkOpen(true)
    setState((prev) => ({
      ...prev,
      activeFlowId: flow.id,
      currentStepIndex: 0,
      completedStepIds: [],
      completedFlowIds: prev.completedFlowIds.filter((flowId) => flowId !== flow.id),
      startedAt: new Date().toISOString(),
      finishedAt: null,
    }))
    navigateToStep(flow.steps[0])
  }

  function resumeFlow() {
    if (!activeFlow || !currentStep || activeFlowCompleted) {
      startFlow(activeFlow?.id || selectedFlowId || preferredFlowId)
      return
    }
    setDismissed(false)
    setCoachmarkOpen(true)
    navigateToStep(currentStep)
  }

  function closeCoachmark() {
    setCoachmarkOpen(false)
  }

  function dismissTutorial() {
    setDismissed(true)
    setModalOpen(false)
    setCoachmarkOpen(false)
  }

  function resetTutorial() {
    clearTutorialState()
    clearTutorialDismissed()
    clearPreferredTutorialFlow()
    setDismissed(false)
    setCoachmarkOpen(false)
    setModalOpen(policy.shouldAutoStart || policy.shouldShowFirstLoginPrompt)
    setSelectedFlowId(defaultFlowIdForUser(user, capabilities))
    setState(DEFAULT_STATE)
  }

  function goToStep(indexOrId) {
    if (!activeFlow) return
    const nextIndex = typeof indexOrId === 'number'
      ? indexOrId
      : activeFlow.steps.findIndex((step) => step.id === indexOrId)
    if (nextIndex < 0 || nextIndex >= activeFlow.steps.length) return

    const nextStep = activeFlow.steps[nextIndex]
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
    preferredFlowId,
    selectedFlowId: selectedFlowId || preferredFlowId,
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
    dismissed,
    flowSummaries,
    hasTutorialState,
    isEnabled,
    location.pathname,
    modalOpen,
    policy,
    preferredFlowId,
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
