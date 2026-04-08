const HTML_ESCAPE_LOOKUP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => HTML_ESCAPE_LOOKUP[char]);
}

export function sanitizeExternalUrl(value, options = {}) {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') {
      return null;
    }

    const allowedHosts = Array.isArray(options.allowedHosts)
      ? options.allowedHosts.filter(Boolean).map((host) => String(host).toLowerCase())
      : [];

    if (allowedHosts.length > 0) {
      const hostname = url.hostname.toLowerCase();
      const isAllowed = allowedHosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
      if (!isAllowed) {
        return null;
      }
    }

    return url.toString();
  } catch (error) {
    return null;
  }
}

export function safeDataId(value) {
  return escapeHtml(String(value ?? ''));
}
