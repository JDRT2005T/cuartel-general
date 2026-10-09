// Arma index.html (versión independiente) a partir de la oficina que vive en Claude (src/oficina-base.html).
// Uso: node build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
let base = read("./src/oficina-base.html");
const app = read("./src/app.js") + "\n" + read("./src/adjuntos.js") + "\n" + read("./src/pro.js") + "\n" + read("./src/admin.js") + "\n" + read("./src/pwa.js");
const adminSection = read("./src/admin.html");
const extra = read("./src/extra.html");
const css = read("./src/extra.css");

function swap(from, to) {
  if (!base.includes(from)) throw new Error("No encontré en la base: " + from.slice(0, 80));
  base = base.replace(from, to);
}

// 1. Arranque: se reemplaza el de Claude por el de Supabase.
const bootAt = base.indexOf("/* ===== Arranque ===== */");
const end = base.lastIndexOf("</script>");
if (bootAt < 0 || end < 0) throw new Error("No encontré el bloque de arranque");
base = base.slice(0, bootAt) + app + "\n" + base.slice(end);

// 2. Cabecera: en vez de "Conexiones", la cuenta y el panel de administración.
swap('<button class="btn sm" data-conn title="Supabase y GitHub">⚙️ Conexiones</button>',
  '<button class="btn sm" data-install hidden title="Instalar app">📲<span class="lbl"> Instalar app</span></button><button class="btn sm primary" id="upBtn" hidden>⭐ Mejorar a Pro</button><button class="btn sm" id="adminBtn" hidden>👑 Administración</button><button class="btn sm" id="acctBtn">👤 Mi cuenta</button>');
// 3. El constructor de sitios automático queda solo en la versión de Claude.
swap('<label class="sitetoggle" for="siteMode">', '<label class="sitetoggle" for="siteMode" hidden>');
swap("$('#jobText').addEventListener('input',e=>{if(siteTouched)return;", "$('#jobText').addEventListener('input',e=>{if(siteTouched||STANDALONE)return;");
// 4. Mensajes de error que vienen del servidor (límite, cuenta) se muestran tal cual.
swap("function errCopy(e){return(", "function errCopy(e){if(e?.srv&&e.message)return e.message;return(");
// 5. La app se muestra recién al entrar.
swap('<div class="app">', '<div class="app" id="appRoot" hidden>');
swap('<div id="ctx" role="menu" hidden></div>', extra.replace('<div class="authwrap" id="auth" hidden>','<div class="authwrap" id="auth">') + '<div id="ctx" role="menu" hidden></div>');
swap("</style>", css + "</style>");
// 6. Pestaña de administración (solo visible para el admin) y avisos en el Inicio.
swap('<button data-tab="chat">Chat</button>', '<button data-tab="chat">Chat</button>\n    <button data-tab="admin" id="admTabBtn" hidden>👑 Admin</button>');
swap("  <!-- CHAT -->", adminSection + "\n  <!-- CHAT -->");
swap('<section id="tab-inicio">', '<section id="tab-inicio">\n    <div id="avisos" class="avisos"></div>');

const head = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Cuartel General: tu oficina con un equipo de IA.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='24' fill='%231A1D23'/><text x='50' y='64' font-size='42' text-anchor='middle' fill='white' font-family='Arial' font-weight='700'>CG</text></svg>">
<link rel="manifest" href="manifest.webmanifest">
<meta name="theme-color" content="#1A1D23">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Cuartel">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>:root{color-scheme:light}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
<script>window.addEventListener("error",function(e){var b=document.getElementById("bootErr")||document.createElement("div");b.id="bootErr";b.style.cssText="position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;background:#C53B3B;color:#fff;padding:12px 16px;border-radius:12px;font:14px system-ui,sans-serif";b.textContent="Algo falló al cargar la app: "+(e.message||"error desconocido")+". Mandale una captura de esto a Claude.";(document.body||document.documentElement).appendChild(b)});</script>
<script src="vendor/supabase.min.js"></script>
`;
let html = head + base.trimStart() + "\n</body>\n</html>\n";
html = html.replace('<div class="app" id="appRoot" hidden>', '</head>\n<body>\n<div class="app" id="appRoot" hidden>');

const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));
if (script.includes("</script")) throw new Error("Hay un </script> dentro del código: rompería la página");
writeFileSync(new URL("./index.html", import.meta.url), html);
writeFileSync(new URL("./build-check.js", import.meta.url), script);
console.log("index.html listo:", (html.length / 1024).toFixed(1), "KB");
