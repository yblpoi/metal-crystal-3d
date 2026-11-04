type IconName =
  | 'logo'
  | 'rotate'
  | 'download'
  | 'recenter'
  | 'settings'
  | 'close'
  | 'chevron'
  | 'cube'
  | 'layers'
  | 'info';

const paths: Record<IconName, string> = {
  logo: '<path d="M12 2.6 20.2 7v10L12 21.4 3.8 17V7L12 2.6Z" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M12 2.6v8.2m0 0 8.2-3.8M12 10.8 3.8 7M12 10.8v10.6" fill="none" stroke="currentColor" stroke-width="1" opacity=".55"/><circle cx="12" cy="10.8" r="1.5" fill="#F6C453"/>',
  rotate:
    '<path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M20 4.5V9h-4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  download:
    '<path d="M12 3.5v11m0 0 4-4m-4 4-4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 15.5v3.2c0 .7.6 1.3 1.3 1.3h12.4c.7 0 1.3-.6 1.3-1.3v-3.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  recenter:
    '<path d="M4 9V5.5C4 4.7 4.7 4 5.5 4H9M15 4h3.5c.8 0 1.5.7 1.5 1.5V9M20 15v3.5c0 .8-.7 1.5-1.5 1.5H15M9 20H5.5c-.8 0-1.5-.7-1.5-1.5V15" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/>',
  settings:
    '<path d="M4 7h9m3 0h4M4 12h3m3 0h10M4 17h7m3 0h6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="15" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="9" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="13" cy="17" r="2" fill="none" stroke="currentColor" stroke-width="1.4"/>',
  close:
    '<path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
  chevron:
    '<path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  cube:
    '<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4 7.5 12 12l8-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1" opacity=".6"/>',
  layers:
    '<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" fill="none" stroke="currentColor" stroke-width="1.3" opacity=".7"/>',
  info: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M12 10.5v6M12 7.5v.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
};

export function icon(name: IconName, size = 16, className = ''): string {
  return `<svg class="icon ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
