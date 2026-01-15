export default async function handler(req, res) {
  // CORS
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Parseo robusto del body (funciona con runtimes que NO parsean JSON)
  let raw = "";
  try {
    if (req.body && typeof req.body === "object") {
      raw = JSON.stringify(req.body);
    } else {
      raw = await new Promise((resolve, reject) => {
        let buf = "";
        req.on("data", (c) => (buf += c));
        req.on("end", () => resolve(buf || "{}"));
        req.on("error", reject);
      });
    }
  } catch (e) {
    console.error("Body parse error:", e);
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  let payload = {};
  try {
    payload = JSON.parse(raw || "{}");
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  // ✅ Nuevos modos (sin necesidad de platform/region/days desde UI)
  const {
    mode = "tendencias_lilly_mx",
    // Legacy params (por si tu HTML viejo los manda)
    platform = "all",
    region = "MX",
    days = 30,
    topic = ""
  } = payload;

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  if (!apiKey) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY env var" });
  }

  // Base: evitar inventar hechos “recientes”
  const systemPrompt = `
Eres un agente especializado en Social Media para Lilly México (farmacéutica).
Tu trabajo es generar reportes robustos y accionables para LinkedIn, Instagram, Facebook y TikTok,
con enfoque en comunicación responsable en salud.

Reglas críticas:
- NO afirmes “cambios recientes del algoritmo” como hechos verificables (no hay navegación web).
- NO inventes métricas, % exactos, ni “top posts reales” con rendimiento.
- Si mencionas tendencias, hazlo como "patrones y mejores prácticas observadas" o "hipótesis".
- Incluye consideraciones de compliance (claims, referencias, tono, riesgos).
- Devuelve EXCLUSIVAMENTE JSON válido que cumpla el schema solicitado.
`.trim();

  // =========================
  // MODE: TENDENCIAS (Lilly MX) - NUEVO (lo dejamos como lo tenías)
  // =========================
  const trendsUserPrompt = `
Necesito un REPORTE MENSUAL DE TENDENCIAS para Social Media de Lilly México.

Contexto fijo:
- Marca: Lilly México (farmacéutica)
- Plataformas: LinkedIn, Instagram, Facebook, TikTok
- Importante: No hay navegación web. No inventes métricas, ni “top posts reales”.
- Sí puedes proponer fuentes RECOMENDADAS con links y referencias en APA (como respaldo), sin afirmar consulta.

Entrega EXACTAMENTE (concisamente):
1) executive_summary: 3–4 bullets (máx 180 caracteres c/u)
2) last_month_patterns: 5–6 bullets (máx 170 caracteres)
3) next_month_opportunities: 5–6 bullets (máx 170 caracteres; si hay efemérides, di “validar fecha”)
4) weekly_calendar: 4 semanas, 3 items por semana (máx 90–140 caracteres por campo)
5) priority_topics: 8 temas exactos (strings cortos)
6) recommended_sources: 6–8 fuentes con url (OMS/OPS/CDC/NIH/PubMed/guías)
7) apa_references: 6–8 referencias APA (máx 220 caracteres)
8) charts:
   - format_mix: 3–5 labels + values que sumen ~100
   - opportunities_per_week: 4 labels + values = número de items por semana

Devuelve SOLO JSON válido.
`.trim();

  const trendsSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "mode",
    "brand",
    "platforms",
    "executive_summary",
    "last_month_patterns",
    "next_month_opportunities",
    "weekly_calendar",
    "priority_topics",
    "recommended_sources",
    "apa_references",
    "charts"
  ],
  properties: {
    mode: { type: "string", enum: ["tendencias_lilly_mx"] },
    brand: { type: "string", maxLength: 60 },
    platforms: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: { type: "string", maxLength: 20 }
    },

    executive_summary: {
      type: "array",
      minItems: 3,
      maxItems: 4,
      items: { type: "string", maxLength: 180 }
    },

    last_month_patterns: {
      type: "array",
      minItems: 5,
      maxItems: 6,
      items: { type: "string", maxLength: 170 }
    },

    next_month_opportunities: {
      type: "array",
      minItems: 5,
      maxItems: 6,
      items: { type: "string", maxLength: 170 }
    },

    weekly_calendar: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["week_label", "items"],
        properties: {
          week_label: { type: "string", maxLength: 40 },
          items: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["theme", "objective", "platform", "format", "hook", "compliance_note"],
              properties: {
                theme: { type: "string", maxLength: 90 },
                objective: { type: "string", maxLength: 120 },
                platform: { type: "string", maxLength: 20 },
                format: { type: "string", maxLength: 60 },
                hook: { type: "string", maxLength: 140 },
                compliance_note: { type: "string", maxLength: 140 }
              }
            }
          }
        }
      }
    },

    priority_topics: {
      type: "array",
      minItems: 8,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["topic", "why_it_matters", "recommended_angle", "risk_flags", "mitigation"],
        properties: {
          topic: { type: "string", maxLength: 70 },
          why_it_matters: { type: "string", maxLength: 160 },
          recommended_angle: { type: "string", maxLength: 120 },
          risk_flags: {
            type: "array",
            minItems: 2,
            maxItems: 3,
            items: { type: "string", maxLength: 90 }
          },
          mitigation: { type: "string", maxLength: 140 }
        }
      }
    },

    recommended_sources: {
      type: "array",
      minItems: 6,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "url", "use_case"],
        properties: {
          name: { type: "string", maxLength: 80 },
          url: { type: "string", maxLength: 220 },
          use_case: { type: "string", maxLength: 110 }
        }
      }
    },

    apa_references: {
      type: "array",
      minItems: 6,
      maxItems: 8,
      items: { type: "string", maxLength: 220 }
    },

    charts: {
      type: "object",
      additionalProperties: false,
      required: ["format_mix", "opportunities_per_week"],
      properties: {
        format_mix: {
          type: "object",
          additionalProperties: false,
          required: ["labels", "values"],
          properties: {
            labels: { type: "array", minItems: 3, maxItems: 5, items: { type: "string", maxLength: 30 } },
            values: { type: "array", minItems: 3, maxItems: 5, items: { type: "number" } }
          }
        },
        opportunities_per_week: {
          type: "object",
          additionalProperties: false,
          required: ["labels", "values"],
          properties: {
            labels: { type: "array", minItems: 4, maxItems: 4, items: { type: "string", maxLength: 20 } },
            values: { type: "array", minItems: 4, maxItems: 4, items: { type: "number" } }
          }
        }
      }
    }
  }
};


  // =========================
  // MODE: CONDUCTA (Lilly MX) - NUEVO (AJUSTADO PARA QUE NO SE CORTE)
  // =========================
  const behaviorUserPrompt = `
Necesito un REPORTE DE CONDUCTA / DIRECTRICES DE FORMATO para Lilly México
en LinkedIn, Instagram, Facebook y TikTok.

REGLAS DE CONCISIÓN (OBLIGATORIO):
- Cada string (bullet) debe tener máximo 120 caracteres.
- No uses "•" ni "-" al inicio.
- No repitas ideas.
- Evita párrafos: solo frases cortas.

Entrega EXACTAMENTE:
1) executive_summary: 3 bullets
2) platform_guidelines: 4 objetos (uno por plataforma) con:
   - goals: 2 bullets
   - signals: 3 bullets (frases accionables, no palabras sueltas)
   - recommended_formats: 2 formatos (specs en 1 frase)
   - copy_guidelines: 4 bullets
3) format_checklist: 4 formatos (video corto, carrusel, estático, stories) con 4 checkpoints c/u
4) compliance_risks: 6 bullets
5) charts.format_mix_by_platform:
   - platforms: 4
   - formats: 3 a 4
   - values: 4 filas que sumen ~100

No incluyas fuentes ni APA en este modo.
`.trim();

  const behaviorSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "mode",
    "brand",
    "platforms",
    "executive_summary",
    "platform_guidelines",
    "format_checklist",
    "compliance_risks",
    "charts"
  ],
  properties: {
    mode: { type: "string", enum: ["conducta_lilly_mx"] },
    brand: { type: "string", maxLength: 40 },
    platforms: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: { type: "string", maxLength: 16 }
    },

    executive_summary: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: { type: "string", maxLength: 120 }
    },

    platform_guidelines: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["platform", "goals", "signals", "recommended_formats", "copy_guidelines"],
        properties: {
          platform: { type: "string", maxLength: 16 },

          goals: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: { type: "string", maxLength: 120 }
          },

          signals: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: { type: "string", maxLength: 120 }
          },

          recommended_formats: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["format", "when_to_use", "specs"],
              properties: {
                format: { type: "string", maxLength: 28 },
                when_to_use: { type: "string", maxLength: 120 },
                specs: { type: "string", maxLength: 120 }
              }
            }
          },

          copy_guidelines: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: { type: "string", maxLength: 120 }
          }
        }
      }
    },

    format_checklist: {
      type: "array",
      minItems: 4,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["format", "checkpoints"],
        properties: {
          format: { type: "string", maxLength: 18 },
          checkpoints: {
            type: "array",
            minItems: 4,
            maxItems: 4,
            items: { type: "string", maxLength: 120 }
          }
        }
      }
    },

    compliance_risks: {
      type: "array",
      minItems: 6,
      maxItems: 6,
      items: { type: "string", maxLength: 120 }
    },

    charts: {
      type: "object",
      additionalProperties: false,
      required: ["format_mix_by_platform"],
      properties: {
        format_mix_by_platform: {
          type: "object",
          additionalProperties: false,
          required: ["platforms", "formats", "values"],
          properties: {
            platforms: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: { type: "string", maxLength: 16 }
            },
            formats: {
              type: "array",
              minItems: 3,
              maxItems: 4,
              items: { type: "string", maxLength: 18 }
            },
            values: {
              type: "array",
              minItems: 4,
              maxItems: 4,
              items: {
                type: "array",
                minItems: 3,
                maxItems: 4,
                items: { type: "number" }
              }
            }
          }
        }
      }
    }
  }
};


  // =========================
  // LEGACY: TENDENCIAS (modo viejo) - para no romper tu tendencias.html actual
  // =========================
  const legacyTrendsUserPrompt = `
Parámetros:
- Plataforma: ${platform}
- Región: ${region}
- Ventana: últimos ${days} días
- Tema (opcional): ${topic || "—"}

Entrega:
- "top5": 5 bullets concretos sobre lo que más creció/funcionó en la ventana indicada.
- "forecast": 3 bullets con hipótesis para el próximo mes (temas/formatos a apostar).
- Evita números inventados; usa lenguaje de tendencia.
- Tono ejecutivo.
- Devuelve texto limpio (sin empezar con "•" o "-").
`.trim();

  const legacyTrendsSchema = {
    type: "object",
    additionalProperties: false,
    required: ["top5", "forecast"],
    properties: {
      top5: { type: "array", minItems: 5, maxItems: 5, items: { type: "string" } },
      forecast: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } }
    }
  };

  // Router (con tokens por modo)
  const modeConfig = {
    // Nuevos
   tendencias_lilly_mx: {
  name: "lilly_trends_report",
  userPrompt: trendsUserPrompt,
  schema: trendsSchema,
  maxTokens: 2600
},
    conducta_lilly_mx: { name: "lilly_behavior_report", userPrompt: behaviorUserPrompt, schema: behaviorSchema, maxTokens: 2200 },


    // Alias (compatibilidad)
    conducta: { name: "lilly_behavior_report", userPrompt: behaviorUserPrompt, schema: behaviorSchema, maxTokens: 2200 },

    tendencias: {
  name: "trends_report_legacy",
  userPrompt: legacyTrendsUserPrompt,
  schema: legacyTrendsSchema,
  maxTokens: 650
},
    
  };

  if (!modeConfig[mode]) {
    return res.status(400).json({ error: `Unsupported mode: ${mode}` });
  }

  const { name, userPrompt, schema, maxTokens = 1000 } = modeConfig[mode];

  try {
    const fullInput = `${systemPrompt}\n\n${userPrompt}`;

 // ✅ Usa el maxTokens del modeConfig (y no dupliques lógica)
const max_output_tokens = Number(maxTokens || 1100);


    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: fullInput,
        max_output_tokens,
        text: {
          format: {
            type: "json_schema",
            name,
            strict: true,
            schema
          }
        }
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("OpenAI error:", r.status, errText);
      return res.status(r.status).json({ error: `OpenAI ${r.status}: ${errText}` });
    }

    const data = await r.json();

    // extractor más robusto
    const jsonText =
      data?.output_text ??
      data?.output?.[0]?.content?.find?.((c) => c?.type === "output_text")?.text ??
      data?.output?.[0]?.content?.[0]?.text ??
      data?.content?.[0]?.text ??
      "{}";
    
    if (typeof jsonText !== "string" || jsonText.trim().length < 2) {
  console.error("Empty or invalid model output:", data);
  return res.status(500).json({
    error: "Empty model output",
    raw: jsonText
  });
}


    let out = {};
    try {
      out = JSON.parse(jsonText);
    } catch (e) {
      console.error("JSON parse from model failed:", e, jsonText);
      out = { error: "Model returned non-JSON", raw: jsonText };
    }

    return res.status(200).json(out);
  } catch (e) {
    console.error("Handler error:", e);
    return res.status(500).json({ error: e.message });
  }
}
