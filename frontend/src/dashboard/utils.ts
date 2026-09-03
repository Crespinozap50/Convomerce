// Two quick sine tones synthesized with the Web Audio API — no asset file to
// ship/host, and it works the same on every OS. Errors are swallowed:
// playing the chime is a nice-to-have, never worth failing anything over.
export function playNotificationSound() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    [880, 1320].forEach((frequency, index) => {
      const start = now + index * 0.12;
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.2, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.18);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.2);
    });
    window.setTimeout(() => void ctx.close(), 500);
  } catch {
    // Audio isn't available/allowed yet (e.g. no user gesture) — skip it.
  }
}
// Only shown when the tab isn't focused: while the admin is actively looking
// at the inbox, a new message already appears there — an OS notification on
// top would just be redundant. The sound chime (called separately) still
// plays either way, matching how chat apps like Slack behave.
export function showDesktopNotification(title: string, body: string, tag: string) {
  if (typeof document !== "undefined" && !document.hidden) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag });
  } catch {
    // Some browsers/contexts (e.g. no service worker on certain mobile
    // browsers) reject the Notification constructor — never fatal here.
  }
}
export function roleName(
  role: string,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  return t(`roles.${role}`, { defaultValue: role });
}
