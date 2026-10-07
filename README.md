# Cuartel General (versión independiente)

Tu oficina con un equipo de IA, fuera de Claude: con usuarios, invitaciones y un límite de gasto por persona.

## Cómo está armada

| Parte | Dónde |
|---|---|
| La página | `index.html` (se genera con `node build.mjs`) |
| Usuarios e inicio de sesión | Supabase Auth, proyecto `lista-tareas` |
| Datos de cada usuario | Tabla `cg_datos` (cada uno ve solo lo suyo) |
| Perfiles, invitaciones, consumo | Tablas `cg_perfiles`, `cg_invitaciones`, `cg_uso` |
| IA | Función `ia` en Supabase → API de Claude (Opus 5). La clave vive cifrada en Vault |
| Panel de administración | Función `admin` (solo acciones fijas, sin SQL libre) |

## Archivos

- `src/oficina-base.html`: la oficina (la misma que la versión de Claude).
- `src/app.js`, `src/extra.html`, `src/extra.css`: lo propio de esta versión (login, cuenta, administración).
- `build.mjs`: arma `index.html` juntando todo.
- `supabase/functions/`: código de las funciones del servidor.

## Primeros pasos (una sola vez)

1. **Apagar la confirmación por correo** (si no, los registros fallan por el límite de correos del plan gratis):
   Supabase → proyecto `lista-tareas` → Authentication → Sign In / Providers → Email → desactivar **Confirm email** → Save.
2. Abrí `index.html`, tocá **Crear cuenta** y usá tu código de administrador.
3. En **👑 Administración**, pegá tu clave de la API de Claude (console.anthropic.com → API Keys).
4. Creá códigos de invitación para tus amigos desde el mismo panel.

## Costos

- Modelo: Claude Opus 5 (US$ 5 por millón de tokens de entrada y US$ 25 por millón de salida).
- El motor Rápido / Normal / Experto cambia cuánto piensa (y cuánto cuesta) cada pedido.
- Cada amigo tiene un límite mensual en US$; vos no tenés límite.

## Pendiente

- Publicarla con link propio (GitHub Pages) cuando esté el token de GitHub.
- Constructor automático de sitios: por ahora solo en la versión de Claude.
- Cobros (Stripe / Mercado Pago) para la etapa de venta.
