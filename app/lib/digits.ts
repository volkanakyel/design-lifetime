import { gsap } from 'gsap'
import { motion } from './morph.mjs'

export function createDigits(element: HTMLElement, reduced: () => boolean) {
  const slots = Array.from(element.querySelectorAll<HTMLElement>('.digit-slot')).map(el => ({
    el, next: el.children[0] as HTMLElement, old: el.children[1] as HTMLElement, blur: el.children[2] as HTMLElement,
    char: el.children[0]!.textContent || ' ',
  }))
  let previous = -1, previousLength = 0
  const duration = (ms: number) => (reduced() ? Math.min(ms, 150) : ms) / 1000
  return (value: number, instant = false, visible = true) => {
    const rounded = Math.round(value)
    if (rounded === previous && !instant) return
    previous = rounded
    const chars = String(rounded).padStart(slots.length, ' '), length = String(rounded).length
    slots.forEach((slot, i) => {
      const char = chars[i]!, shift = (i - slots.length + length / 2) * 100
      const position = { x: 0, xPercent: shift, opacity: char === ' ' ? 0 : 1 }
      if (instant || (!visible && length !== previousLength)) gsap.set(slot.el, position)
      else if (length !== previousLength) gsap.to(slot.el, { ...position, duration: duration(motion.duration.sm) })
      if (slot.char === char && !instant) return
      gsap.killTweensOf([slot.next, slot.old, slot.blur])
      slot.old.textContent = slot.char.trim(); slot.blur.textContent = slot.char.trim(); slot.next.textContent = char.trim(); slot.char = char
      if (instant || !visible) { gsap.set(slot.next, { y: 0, opacity: 1 }); gsap.set([slot.old, slot.blur], { y: 0, opacity: 0 }); return }
      gsap.fromTo(slot.old, { y: 0, opacity: 1 }, { y: reduced() ? 0 : -4, opacity: 0, duration: duration(motion.duration.smExit) })
      if (!reduced()) gsap.fromTo(slot.blur, { y: 0, opacity: .2 }, { y: -4, opacity: 0, duration: motion.duration.smExit / 1000 })
      gsap.fromTo(slot.next, { y: reduced() ? 0 : 4, opacity: 0 }, { y: 0, opacity: 1, duration: duration(motion.duration.sm) })
    })
    previousLength = length
  }
}
