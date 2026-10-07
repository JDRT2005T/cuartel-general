// Cuartel General · función "ia"
// Recibe el pedido del navegador, controla el límite mensual de cada usuario,
// llama a Claude con la clave guardada en el servidor y devuelve la respuesta en vivo (SSE).
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2";
import postgres from "npm:postgres@3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
// Cada motor usa un modelo distinto. Precios en US$ por millón de tokens.
type Engine = { model: string; in: number; out: number; cacheRead: number; cacheWrite: number; effort?: "medium" | "high"; fallback?: boolean };
const ENGINES: Record<string, Engine> = {
  quick: { model: "claude-haiku-4-5", in: 1, out: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  default: { model: "claude-sonnet-5", in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5, effort: "medium" },
  complex: { model: "claude-opus-5", in: 5, out: 25, cacheRead: 0.5, cacheWrite: 6.25, effort: "high", fallback: true },
};

const db = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2 });

async function apiKey(): Promise<string> {
  const env = Deno.env.get("ANTHROPIC_API_KEY");
  if (env) return env;
  const r = await db`select decrypted_secret from vault.decrypted_secrets where name = 'anthropic_api_key' limit 1`;
  return r[0]?.decrypted_secret ?? "";
}

const jerr = (code: string, message: string, status = 200) =>
  new Response(JSON.stringify({ error: code, message }), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jerr("invalid_request", "Usá POST", 405);

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return jerr("session_expired", "Tu sesión venció. Iniciá sesión de nuevo.", 401);

  const [p] = await db`
    select rol, plan, limite_usd, activo,
      coalesce((select sum(costo_usd) from public.cg_uso where user_id = ${user.id} and creado >= date_trunc('month', now())), 0) as usado
    from public.cg_perfiles where id = ${user.id}`;
  if (!p || !p.activo) return jerr("not_granted", "Tu cuenta no está habilitada.");
  if (p.rol !== "admin" && Number(p.usado) >= Number(p.limite_usd)) {
    return jerr("rate_limited", `Llegaste a tu límite de este mes (US$ ${Number(p.limite_usd).toFixed(2)}). Pedile más al administrador.`);
  }

  const key = await apiKey();
  if (!key) return jerr("sampling_disabled", "Falta configurar la clave de la API de Claude. El administrador la carga en 👑 Administración.");

  let body: { input?: unknown; tier?: string; json?: boolean; max_tokens?: number };
  try { body = await req.json(); } catch { return jerr("invalid_request", "Pedido inválido"); }

  let messages: Anthropic.Beta.BetaMessageParam[];
  if (typeof body.input === "string" && body.input.trim()) {
    messages = [{ role: "user", content: body.input }];
  } else if (Array.isArray(body.input) && body.input.length) {
    messages = (body.input as { role: string; content: unknown }[])
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content as string }));
  } else return jerr("invalid_request", "Falta el texto del pedido");
  if (!messages.length || messages[0].role !== "user" || messages[messages.length - 1].role !== "user") {
    return jerr("invalid_request", "La conversación tiene que empezar y terminar con un mensaje del usuario");
  }
  if (JSON.stringify(messages).length > 400_000) return jerr("prompt_too_large", "El pedido es demasiado largo");

  const tier = body.tier && body.tier in ENGINES ? body.tier : "default";
  if (tier === "complex" && p.rol !== "admin" && p.plan !== "pro") {
    return jerr("not_granted", "El motor Experto es del plan Pro. Usá Rápido o Normal, o pedile al administrador que te pase a Pro.");
  }
  const eng = ENGINES[tier];

  const system = "Trabajás dentro de Cuartel General, la oficina personal del usuario. Respondés en español." +
    (body.json ? " Tu respuesta la lee un programa: respondé SOLO con el JSON pedido, sin texto antes ni después y sin bloques de código." : "");

  const client = new Anthropic({ apiKey: key });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const send = (o: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      try {
        // Rápido = Haiku 4.5 (sin pensamiento extendido), Normal = Sonnet 5 y Experto = Opus 5, ambos con pensamiento adaptativo.
        // En Opus 5, fallbacks "default": si rechaza el pedido por políticas, el servidor lo reintenta con el modelo recomendado.
        // deno-lint-ignore no-explicit-any
        const params: any = {
          model: eng.model,
          max_tokens: Math.min(Math.max(Number(body.max_tokens) || 32000, 1024), 64000),
          system,
          messages,
          cache_control: { type: "ephemeral" },
        };
        if (eng.effort) {
          params.thinking = { type: "adaptive" };
          params.output_config = { effort: eng.effort };
        }
        if (eng.fallback) {
          params.betas = ["server-side-fallback-2026-07-01"];
          params.fallbacks = "default";
        }
        const s = client.beta.messages.stream(params);
        s.on("text", (t: string) => send({ t }));
        const m = await s.finalMessage();
        const u = m.usage;
        const cost = (u.input_tokens * eng.in + u.output_tokens * eng.out +
          (u.cache_read_input_tokens ?? 0) * eng.cacheRead + (u.cache_creation_input_tokens ?? 0) * eng.cacheWrite) / 1e6;
        await db`insert into public.cg_uso (user_id, modelo, tokens_entrada, tokens_salida, costo_usd)
                 values (${user.id}, ${m.model}, ${u.input_tokens}, ${u.output_tokens}, ${cost})`;
        if (m.stop_reason === "refusal") send({ error: "refused", message: "Claude no pudo responder a ese pedido. Probá contarlo de otra forma." });
        else send({ done: true, truncated: m.stop_reason === "max_tokens", usd: cost });
      } catch (e) {
        let code = "upstream_error";
        if (e instanceof Anthropic.AuthenticationError) code = "sampling_disabled";
        else if (e instanceof Anthropic.RateLimitError) code = "rate_limited";
        else if (e instanceof Anthropic.BadRequestError) code = "invalid_request";
        send({ error: code, message: String((e as Error)?.message ?? e).slice(0, 300) });
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
});
