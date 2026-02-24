/**
 * Build WhatsApp click-to-chat URL
 * @param {string} phoneDigits - Phone number in international format (digits only, e.g. "917975357599")
 * @param {string} text - Prefilled message text
 * @returns {string} WhatsApp URL
 */
export function buildWhatsAppLink(phoneDigits, text) {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(text)}`
}

/**
 * Build prefilled support message for WhatsApp
 * @param {Object} params
 * @param {string} params.assignmentRef - Assignment reference number
 * @param {string} params.supportLink - Support portal link
 * @returns {string} Formatted message text
 */
export function buildSupportMessage({ assignmentRef, supportLink }) {
  if (assignmentRef && supportLink) {
    return `Hi, I need help for Assignment ${assignmentRef}. Support link: ${supportLink}`
  }
  if (assignmentRef) {
    return `Hi, I need help for Assignment ${assignmentRef}.`
  }
  return 'Hi, I need support with Zen Ops.'
}
