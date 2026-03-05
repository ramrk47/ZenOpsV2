import { useEffect, useState } from 'react'

const MOBILE_QUERY = '(max-width: 767px)'

export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(MOBILE_QUERY).matches
  })

  useEffect(() => {
    if (!window.matchMedia) return undefined
    const media = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(media.matches)

    onChange()
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  return isMobile
}
