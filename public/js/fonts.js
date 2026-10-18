// Web fonts are added by script, which never blocks rendering: if Google
// Fonts is slow or unreachable, the page simply keeps the fallback fonts.
(function () {
  var fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href = 'https://fonts.googleapis.com/css2'
    + '?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500'
    + '&family=Inter:wght@300..600&family=IBM+Plex+Mono:wght@400;500&display=swap';
  document.head.appendChild(fonts);
})();
