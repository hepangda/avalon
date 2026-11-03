/** Ways to reach a player whose tab is in the background: the tab title, its icon, the OS, the phone. */

let flashTimer: ReturnType<typeof setInterval> | null = null;
let restingTitle: string | null = null;

export function flashTitle(message: string) {
  stopTitleFlash();
  restingTitle = document.title;
  const resting = restingTitle;
  const alert = `${message} · ${resting}`;
  document.title = alert;
  flashTimer = setInterval(() => {
    document.title = document.title === alert ? resting : alert;
  }, 1000);
}

export function stopTitleFlash() {
  if (flashTimer !== null) clearInterval(flashTimer);
  flashTimer = null;
  if (restingTitle !== null) document.title = restingTitle;
  restingTitle = null;
}

let iconLinks: Array<{ link: HTMLLinkElement; href: string; type: string; sizes: string }> | null = null;
let badgeUrl: Promise<string> | null = null;

/** The crest with a crimson dot at its shoulder; falls back to the dot on a gilt seal. */
function drawBadge(source: string | undefined): Promise<string> {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) return Promise.reject(new Error('no canvas'));
  const finish = () => {
    g.beginPath();
    g.arc(size * 0.76, size * 0.24, size * 0.2, 0, Math.PI * 2);
    g.fillStyle = '#d0392b';
    g.fill();
    g.lineWidth = size * 0.06;
    g.strokeStyle = '#16100a';
    g.stroke();
    return canvas.toDataURL('image/png');
  };
  const plain = () => {
    g.clearRect(0, 0, size, size);
    g.beginPath();
    g.arc(size / 2, size / 2, size * 0.42, 0, Math.PI * 2);
    g.fillStyle = '#221c14';
    g.fill();
    g.lineWidth = size * 0.07;
    g.strokeStyle = '#c9a227';
    g.stroke();
    return finish();
  };
  if (!source) return Promise.resolve(plain());
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        g.drawImage(img, 0, 0, size, size);
        resolve(finish());
      } catch {
        resolve(plain());
      }
    };
    img.onerror = () => resolve(plain());
    img.src = source;
  });
}

export function showIconBadge() {
  const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
  if (!iconLinks) iconLinks = links.map((link) => ({ link, href: link.href, type: link.type, sizes: link.getAttribute('sizes') ?? '' }));
  // The largest icon draws cleanest at badge size.
  const source = iconLinks.find((icon) => icon.type === 'image/webp' || icon.type === 'image/png')?.href ?? iconLinks[0]?.href;
  badgeUrl ??= drawBadge(source);
  void badgeUrl.then((url) => {
    if (!iconLinks) return;
    for (const { link } of iconLinks) {
      link.type = 'image/png';
      link.removeAttribute('sizes');
      link.href = url;
    }
  }).catch(() => {});
}

export function clearIconBadge() {
  if (!iconLinks) return;
  for (const { link, href, type, sizes } of iconLinks) {
    link.href = href;
    link.type = type;
    if (sizes) link.setAttribute('sizes', sizes);
  }
  iconLinks = null;
}

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

let shown: Notification | null = null;

export function notify(title: string, body: string, icon?: string) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    shown?.close();
    shown = new Notification(title, { body, icon, tag: 'avalon-turn' });
    shown.onclick = () => {
      window.focus();
      shown?.close();
    };
  } catch {
    // Mobile Chrome only shows notifications through a service worker; the title and buzz still land.
    shown = null;
  }
}

export function closeNotification() {
  shown?.close();
  shown = null;
}

export function buzz() {
  try {
    navigator.vibrate?.(180);
  } catch { /* unsupported */ }
}
