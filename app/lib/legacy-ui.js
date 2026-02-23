'use strict';

/**
 * Devuelve HTML para la ruta /classic (UI clásica).
 * El simulador OBD2 y GPS están en el dashboard principal; esta página redirige.
 */
function loadLegacyWebUiHtml() {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>UI clásica</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 2rem auto; padding: 0 1rem; }
    a { color: #0a7ea4; }
  </style>
</head>
<body>
  <h1>UI clásica</h1>
  <p>El emulador OBD2 y el GPS virtual están integrados en el <strong>dashboard principal</strong>.</p>
  <p><a href="/">Ir al dashboard</a></p>
</body>
</html>`;
}

module.exports = { loadLegacyWebUiHtml };
