import { useContext } from 'react'

import { DemoTutorialContext } from './DemoTutorialContext.jsx'

export function useDemoTutorial() {
  const context = useContext(DemoTutorialContext)
  if (!context) {
    throw new Error('useDemoTutorial must be used inside DemoTutorialProvider')
  }
  return context
}
