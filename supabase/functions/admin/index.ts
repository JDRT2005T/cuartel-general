// Cuartel General · función "admin"
// Solo para el administrador. Acciones fijas y con parámetros (no ejecuta SQL libre):
// estado, clave de la API, invitaciones, usuarios, panel, pagos y avisos.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const db = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });
const out = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => "CG-" + Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CHARS[b % CHARS.length]).join("");
const money = (v: unknown) => Math.min(Math.max(Number(v) || 0, 0), 1000);

// Da Pro por N meses (suma a lo que le quede si ya era Pro). 0 meses = sin vencimiento.
async function darPro(id: string, meses: number) {
  const m = Math.min(Math.max(Math.round(meses), 0), 36);
  if (!m) await db`update public.cg_perfiles set plan = 'pro', pro_hasta = null where id = ${id}`;
  else await db`update public.cg_perfiles set plan = 'pro',
      pro_hasta = greatest(now(), coalesce(case when plan = 'pro' then pro_hasta end, now())) + make_interval(months => ${m}::int)
    where id = ${id}`;
}
// Saldo cargado en Anthropic menos lo gastado desde esa fecha.
async function saldo() {
  const [c] = await db`select valor from public.cg_config where clave = 'saldo'`;
  if (!c) return null;
  const desde = c.valor.desde, cargado = Number(c.valor.cargado_usd) || 0;
  const [g] = await db`select coalesce(sum(costo_usd), 0)::float as g from public.cg_uso where creado >= ${desde}::timestamptz`;
  const [d] = await db`select coalesce(sum(costo_usd), 0)::float / 7 as d from public.cg_uso where creado >= now() - interval '7 days'`;
  const restante = cargado - g.g;
  return { cargado_usd: cargado, desde, gastado_usd: g.g, restante_usd: restante, por_dia_usd: d.d, dias_restantes: d.d > 0 ? Math.floor(restante / d.d) : null };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return out({ ok: false, error: "Usá POST" }, 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return out({ ok: false, error: "Tu sesión venció. Iniciá sesión de nuevo." }, 401);
  const [me] = await db`select rol, activo from public.cg_perfiles where id = ${user.id}`;
  if (!me || !me.activo || me.rol !== "admin") return out({ ok: false, error: "Solo el administrador puede hacer esto." }, 403);

  // deno-lint-ignore no-explicit-any
  let b: any;
  try { b = await req.json(); } catch { return out({ ok: false, error: "Pedido inválido" }); }

  try {
    switch (b.action) {
      case "status": {
        const [k] = await db`select count(*)::int as n from vault.secrets where name = 'anthropic_api_key'`;
        return out({ ok: true, apiKey: k.n > 0 });
      }
      case "set_api_key": {
        const k = String(b.key ?? "").trim();
        if (/^sk-ant-admin/i.test(k)) {
          return out({ ok: false, error: "Esa es una Admin Key, sirve para administrar la organización pero no para usar la IA. Creá una en la sección API keys." });
        }
        if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k)) {
          return out({ ok: false, error: "No parece una clave de Anthropic: tiene que empezar con sk-ant-. Fijate de copiarla completa, sin espacios." });
        }
        // Se prueba de verdad contra la API antes de guardarla.
        try {
          // Pedido mínimo real (el mismo tipo de llamada que usa la app) para confirmar que la clave sirve.
          await new Anthropic({ apiKey: k }).messages.create({ model: "claude-opus-5", max_tokens: 16, messages: [{ role: "user", content: "Respondé solo: ok" }] });
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError) return out({ ok: false, error: "Anthropic dice que esa clave no es válida. Revisá que esté completa o creá una nueva." });
          if (e instanceof Anthropic.PermissionDeniedError) return out({ ok: false, error: "La clave existe pero no tiene permiso. Revisá en console.anthropic.com que esté activa." });
          if (e instanceof Anthropic.BadRequestError && /credit|balance|billing/i.test(String((e as Error).message))) {
            return out({ ok: false, error: "La clave funciona pero tu cuenta no tiene saldo. Cargá saldo en console.anthropic.com → Billing y volvé a guardarla." });
          }
          return out({ ok: false, error: "No pude comprobar la clave con Anthropic: " + String((e as Error)?.message ?? e).slice(0, 200) });
        }
        const [ex] = await db`select id from vault.secrets where name = 'anthropic_api_key'`;
        if (ex) await db`select vault.update_secret(${ex.id}, ${k})`;
        else await db`select vault.create_secret(${k}, 'anthropic_api_key', 'Clave de la API de Claude para Cuartel General')`;
        return out({ ok: true });
      }
      case "list_invites": {
        const rows = await db`
          select i.codigo, i.rol, i.limite_usd, i.nota, i.creado, i.usada_en, p.nombre as usada_por_nombre
          from public.cg_invitaciones i left join public.cg_perfiles p on p.id = i.usada_por
          order by i.creado desc limit 100`;
        return out({ ok: true, rows });
      }
      case "create_invite": {
        const rol = b.rol === "cliente" ? "cliente" : "amigo";
        const code = newCode();
        // El límite de uso ya no va en la invitación: lo pone solo el plan (ver get_limites/set_limites).
        await db`insert into public.cg_invitaciones (codigo, rol, nota)
                 values (${code}, ${rol}, ${String(b.nota ?? "").slice(0, 80)})`;
        return out({ ok: true, codigo: code });
      }
      case "delete_invite": {
        await db`delete from public.cg_invitaciones where codigo = ${String(b.codigo ?? "")} and usada_por is null`;
        return out({ ok: true });
      }
      case "get_limites": {
        const [c] = await db`select valor from public.cg_config where clave = 'limites'`;
        return out({ ok: true, limites: { gratis: 1, pro: 3, ...(c?.valor ?? {}) } });
      }
      case "set_limites": {
        const gratis = money(b.gratis), pro = money(b.pro);
        if (pro < gratis) return out({ ok: false, error: "El límite de Pro tiene que ser igual o mayor que el de Gratis." });
        await db`insert into public.cg_config (clave, valor) values ('limites', ${db.json({ gratis, pro })})
                 on conflict (clave) do update set valor = excluded.valor, actualizado = now()`;
        return out({ ok: true, limites: { gratis, pro } });
      }
      case "list_users": {
        const rows = await db`
          select p.id, p.nombre, u.email, p.rol, p.plan, p.pro_hasta, public.cg_limite(p.rol, p.plan, p.pro_hasta, p.limite_usd)::float as limite_usd, p.activo, p.creado,
            case when p.plan = 'pro' and (p.pro_hasta is null or p.pro_hasta > now()) then 'pro' else 'gratis' end as plan_efectivo,
            coalesce((select sum(costo_usd) from public.cg_uso c where c.user_id = p.id and c.creado >= date_trunc('month', now())), 0)::float as usado_mes,
            coalesce((select count(*) from public.cg_uso c where c.user_id = p.id and c.creado >= date_trunc('month', now())), 0)::int as pedidos_mes
          from public.cg_perfiles p join auth.users u on u.id = p.id
          order by p.creado`;
        return out({ ok: true, rows });
      }
      case "update_user": {
        const id = String(b.id ?? "");
        if (id === user.id && b.activo === false) return out({ ok: false, error: "No podés desactivar tu propia cuenta." });
        if (typeof b.activo === "boolean") await db`update public.cg_perfiles set activo = ${b.activo} where id = ${id}`;
        if (b.plan === "gratis") await db`update public.cg_perfiles set plan = 'gratis', pro_hasta = null where id = ${id}`;
        if (b.plan === "pro") await darPro(id, Number(b.meses) || 0);
        return out({ ok: true });
      }
      case "dashboard": {
        const [tot] = await db`
          select
            coalesce((select sum(costo_usd) from public.cg_uso where creado >= date_trunc('month', now())), 0)::float as gastado_mes,
            coalesce((select sum(monto_usd) from public.cg_pagos where creado >= date_trunc('month', now())), 0)::float as cobrado_mes,
            coalesce((select sum(costo_usd) from public.cg_uso), 0)::float as gastado_total,
            coalesce((select sum(monto_usd) from public.cg_pagos), 0)::float as cobrado_total,
            (select count(*) from public.cg_uso where creado >= date_trunc('month', now()))::int as pedidos_mes,
            (select count(distinct user_id) from public.cg_uso where creado >= now() - interval '30 days')::int as activos_30d,
            (select count(*) from public.cg_perfiles)::int as usuarios,
            (select count(*) from public.cg_perfiles where plan = 'pro' and (pro_hasta is null or pro_hasta > now()))::int as pro`;
        const dias = await db`
          select to_char(d, 'YYYY-MM-DD') as dia,
            coalesce((select sum(costo_usd) from public.cg_uso u where u.creado >= d and u.creado < d + interval '1 day'), 0)::float as gastado,
            coalesce((select count(*) from public.cg_uso u where u.creado >= d and u.creado < d + interval '1 day'), 0)::int as pedidos
          from generate_series(date_trunc('day', now()) - interval '29 days', date_trunc('day', now()), interval '1 day') d
          order by d`;
        const meses = await db`
          select to_char(m, 'YYYY-MM') as mes,
            coalesce((select sum(costo_usd) from public.cg_uso u where u.creado >= m and u.creado < m + interval '1 month'), 0)::float as gastado,
            coalesce((select sum(monto_usd) from public.cg_pagos p where p.creado >= m and p.creado < m + interval '1 month'), 0)::float as cobrado
          from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
          order by m`;
        const motores = await db`
          select modelo, sum(costo_usd)::float as gastado, count(*)::int as pedidos
          from public.cg_uso where creado >= date_trunc('month', now()) group by modelo order by 2 desc`;
        const top = await db`
          select p.nombre, case when p.plan = 'pro' and (p.pro_hasta is null or p.pro_hasta > now()) then 'pro' else 'gratis' end as plan,
            sum(u.costo_usd)::float as gastado, count(*)::int as pedidos
          from public.cg_uso u join public.cg_perfiles p on p.id = u.user_id
          where u.creado >= date_trunc('month', now()) group by 1, 2 order by 3 desc limit 8`;
        return out({ ok: true, tot, dias, meses, motores, top, saldo: await saldo() });
      }
      case "set_saldo": {
        // modo "recarga": suma al saldo actual; modo "fijar": arranca la cuenta de nuevo desde hoy.
        const monto = Number(b.monto_usd);
        if (!(monto >= 0 && monto <= 100000)) return out({ ok: false, error: "Poné un monto válido en dólares." });
        const [cur] = await db`select valor from public.cg_config where clave = 'saldo'`;
        const v = b.modo === "recarga" && cur
          ? { cargado_usd: Number(cur.valor.cargado_usd) + monto, desde: cur.valor.desde }
          : { cargado_usd: monto, desde: new Date().toISOString() };
        await db`insert into public.cg_config (clave, valor) values ('saldo', ${db.json(v)})
                 on conflict (clave) do update set valor = excluded.valor, actualizado = now()`;
        return out({ ok: true, saldo: await saldo() });
      }
      case "list_payments": {
        const rows = await db`
          select g.id, g.monto_usd::float as monto_usd, g.concepto, g.creado, p.nombre, g.proveedor, g.monto_local::float as monto_local, g.moneda
          from public.cg_pagos g left join public.cg_perfiles p on p.id = g.user_id
          order by g.creado desc limit 50`;
        return out({ ok: true, rows });
      }
      case "add_payment": {
        const monto = Number(b.monto_usd);
        if (!(monto > 0 && monto <= 100000)) return out({ ok: false, error: "Poné un monto válido en dólares." });
        const uid = b.user_id ? String(b.user_id) : null;
        await db`insert into public.cg_pagos (user_id, monto_usd, concepto) values (${uid}, ${monto}, ${String(b.concepto ?? "Plan Pro").slice(0, 120) || "Plan Pro"})`;
        if (uid && Number(b.meses) > 0) await darPro(uid, Number(b.meses));
        return out({ ok: true });
      }
      case "delete_payment": {
        await db`delete from public.cg_pagos where id = ${Number(b.id) || 0}`;
        return out({ ok: true });
      }
      case "list_avisos": {
        const rows = await db`select id, titulo, texto, tipo, activo, hasta, creado from public.cg_avisos order by creado desc limit 50`;
        return out({ ok: true, rows });
      }
      case "create_aviso": {
        const titulo = String(b.titulo ?? "").trim().slice(0, 80);
        if (!titulo) return out({ ok: false, error: "Escribí un título para el aviso." });
        const tipo = ["info", "nuevo", "mantenimiento", "importante"].includes(b.tipo) ? b.tipo : "info";
        const dias = Math.min(Math.max(Number(b.dias) || 0, 0), 365);
        const hasta = dias ? new Date(Date.now() + dias * 864e5).toISOString() : null;
        await db`insert into public.cg_avisos (titulo, texto, tipo, hasta) values (${titulo}, ${String(b.texto ?? "").slice(0, 500)}, ${tipo}, ${hasta})`;
        return out({ ok: true });
      }
      case "toggle_aviso": {
        await db`update public.cg_avisos set activo = ${!!b.activo} where id = ${Number(b.id) || 0}`;
        return out({ ok: true });
      }
      case "delete_aviso": {
        await db`delete from public.cg_avisos where id = ${Number(b.id) || 0}`;
        return out({ ok: true });
      }
      case "wompi_status": {
        const [c] = await db`select valor from public.cg_config where clave = 'wompi'`;
        const [s] = await db`select count(*) filter (where name = 'wompi_integrity_secret')::int as i, count(*) filter (where name = 'wompi_events_secret')::int as e from vault.secrets`;
        const [pend] = await db`select count(*)::int as n from public.cg_checkouts where estado = 'pendiente' and proveedor = 'wompi' and creado > now() - interval '2 days'`;
        return out({ ok: true, configurado: !!c?.valor?.public_key && s.i > 0 && s.e > 0, config: c?.valor ?? null, pendientes: pend.n, webhook: `${Deno.env.get("SUPABASE_URL")}/functions/v1/wompi-webhook` });
      }
      case "set_wompi": {
        const precio = Math.round(Number(b.precio_local)), precioUsd = Number(b.precio_usd) || 5;
        if (!(precio >= 1500 && precio < 100_000_000)) return out({ ok: false, error: "Poné el precio del plan Pro en pesos colombianos (mínimo 1.500)." });
        const pub = String(b.public_key ?? "").trim(), integ = String(b.integrity ?? "").trim(), evts = String(b.events ?? "").trim();
        const [cur] = await db`select valor from public.cg_config where clave = 'wompi'`;
        let base = cur?.valor ?? null;
        if (pub || integ || evts) {
          if (!/^pub_(test|prod)_[A-Za-z0-9]{10,}$/.test(pub)) return out({ ok: false, error: "La llave pública tiene que empezar con pub_test_ o pub_prod_." });
          const modo = pub.startsWith("pub_test_") ? "test" : "prod";
          if (!new RegExp(`^${modo}_integrity_[A-Za-z0-9]{10,}$`).test(integ)) return out({ ok: false, error: `El secreto de integridad tiene que empezar con ${modo}_integrity_ (del mismo ambiente que la llave pública).` });
          if (!new RegExp(`^${modo}_events_[A-Za-z0-9]{10,}$`).test(evts)) return out({ ok: false, error: `El secreto de eventos tiene que empezar con ${modo}_events_ (del mismo ambiente que la llave pública).` });
          const r = await fetch(`https://${modo === "test" ? "sandbox" : "production"}.wompi.co/v1/merchants/${pub}`);
          if (!r.ok) return out({ ok: false, error: "Wompi no reconoce esa llave pública. Copiala completa desde Desarrolladores → Llaves." });
          const m = (await r.json()).data ?? {};
          base = { public_key: pub, prueba: modo === "test", comercio: m.name ?? m.legal_name ?? "" };
          for (const [name, val] of [["wompi_integrity_secret", integ], ["wompi_events_secret", evts]]) {
            const [ex] = await db`select id from vault.secrets where name = ${name}`;
            if (ex) await db`select vault.update_secret(${ex.id}, ${val})`;
            else await db`select vault.create_secret(${val}, ${name}, 'Secreto de Wompi para Cuartel General')`;
          }
        }
        if (!base?.public_key) return out({ ok: false, error: "Pegá la llave pública y los dos secretos de Wompi." });
        const v = { ...base, precio_local: precio, precio_usd: Math.min(Math.max(precioUsd, 0.5), 1000), meses: 1 };
        await db`insert into public.cg_config (clave, valor) values ('wompi', ${db.json(v)})
                 on conflict (clave) do update set valor = excluded.valor, actualizado = now()`;
        return out({ ok: true, config: v });
      }
      default:
        return out({ ok: false, error: "Acción desconocida" });
    }
  } catch (e) {
    return out({ ok: false, error: String((e as Error)?.message ?? e).slice(0, 500) });
  }
});
