## Resultados por modelo

| Modelo | Completas | Global | Claridad | Verificabilidad | Completitud | Consistencia |
| --- | --- | --- | --- | --- | --- | --- |
| Anthropic · Claude Haiku 5.5 (tool) * | 15 de 15 | 2.73 | 3.00 | 2.87 | 2.47 | 2.60 |
| Groq · GPT-OSS 20B (native) | 14 de 15 | 2.82 | 3.07 | 3.07 | 2.50 | 2.64 |
| Ollama · Llama 3.1 8B (native) | 11 de 15 | 2.05 | 2.18 | 2.18 | 2.00 | 1.82 |

## Comparación sobre los casos comunes

11 casos que todos los modelos completaron y el juez calificó: `dificil-01`, `dificil-03`, `dificil-04`, `facil-02`, `facil-03`, `facil-04`, `facil-05`, `medio-01`, `medio-02`, `medio-04`, `medio-05`. El promedio general de cada modelo usa todas sus corridas completas; el de los casos comunes compara a todos sobre el mismo terreno.

| Modelo | Global (todas) | Global (comunes) | Claridad | Verificabilidad | Completitud | Consistencia |
| --- | --- | --- | --- | --- | --- | --- |
| Anthropic · Claude Haiku 5.5 (tool) * | 2.73 (15) | 2.70 (11) | 3.00 | 2.82 | 2.45 | 2.55 |
| Groq · GPT-OSS 20B (native) | 2.82 (14) | 2.82 (11) | 3.09 | 3.09 | 2.45 | 2.64 |
| Ollama · Llama 3.1 8B (native) | 2.05 (11) | 2.05 (11) | 2.18 | 2.18 | 2.00 | 1.82 |

Entre paréntesis, las corridas que entran en cada promedio.

## Operación por modelo

| Modelo | Válidas a la primera | Rondas medias | Latencia p50 | Latencia p95 | Tokens por corrida | Costo por corrida (USD) | Costo del lote (USD) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Anthropic · Claude Haiku 5.5 (tool) * | 97% (145 de 149) | 2.0 | 148 s | 207 s | 127841 | 0.0296 | 0.4442 |
| Groq · GPT-OSS 20B (native) | 96% (102 de 106) | 1.6 | 33 s | 61 s | 47129 | 0.0089 | 0.1264 |
| Ollama · Llama 3.1 8B (native) | 90% (111 de 123) | 2.0 | 329 s | 476 s | 54328 | 0.0015 | 0.0160 |

## Errores por código

| Modelo | Errores |
| --- | --- |
| Anthropic · Claude Haiku 5.5 (tool) * | ninguno |
| Groq · GPT-OSS 20B (native) | `salida_invalida`: 1 |
| Ollama · Llama 3.1 8B (native) | `proveedor_no_disponible`: 4 |

## Por dificultad

| Modelo | Fáciles: completas · global | Medios: completas · global | Difíciles: completas · global |
| --- | --- | --- | --- |
| Anthropic · Claude Haiku 5.5 (tool) * | 5 de 5 · 3.00 | 5 de 5 · 2.70 | 5 de 5 · 2.50 |
| Groq · GPT-OSS 20B (native) | 5 de 5 · 2.90 | 4 de 5 · 2.94 | 5 de 5 · 2.65 |
| Ollama · Llama 3.1 8B (native) | 4 de 5 · 2.19 | 4 de 5 · 1.94 | 3 de 5 · 2.00 |

## Detección de problemas sembrados (casos difíciles)

| Modelo | Casos emparejados | Total | Ambigüedad | Inconsistencia | Faltante | En los difíciles comunes (3) |
| --- | --- | --- | --- | --- | --- | --- |
| Anthropic · Claude Haiku 5.5 (tool) * | 5 de 5 | 52% (13 de 25) | 71% (5 de 7) | 67% (4 de 6) | 33% (4 de 12) | 60% (9 de 15) |
| Groq · GPT-OSS 20B (native) | 5 de 5 | 32% (8 de 25) | 14% (1 de 7) | 67% (4 de 6) | 25% (3 de 12) | 27% (4 de 15) |
| Ollama · Llama 3.1 8B (native) | 3 de 5 † | 7% (1 de 15) | 20% (1 de 5) | 0% (0 de 3) | 0% (0 de 7) | 7% (1 de 15) |

† No directamente comparable: el modelo no completó todos los casos difíciles y el emparejador solo leyó los que completó. La última columna compara a todos sobre los mismos casos.

Problemas que ningún modelo detectó, entre los que completaron cada caso:

- `dificil-01` (Faltante): No dice qué pasa con una entrega fallida (tienda cerrada, pedido rechazado o devolución).
- `dificil-01` (Faltante): No dice qué hacer si los pedidos del día exceden la capacidad de los camiones disponibles.
- `dificil-02` (Ambigüedad): "Pequeños productores" no tiene un criterio (superficie, ingresos u otro).
- `dificil-02` (Faltante): No dice qué pasa si el técnico encuentra una superficie distinta a la declarada.
- `dificil-04` (Ambigüedad): "Fácil de usar" y "funcionar bien en cualquier dispositivo" no son verificables.
- `dificil-04` (Faltante): No dice cómo se forman los equipos ni qué pasa si un integrante no participó.
- `dificil-04` (Faltante): No dice cómo se vincula a un padre o madre con su hijo ni qué tipos y tamaños de archivo se aceptan.
- `dificil-05` (Faltante): No dice con qué criterios aprueba la coordinación ni cómo se resuelven dos solicitudes para el mismo horario.
- `dificil-05` (Faltante): No dice cómo se registra el equipo de cada quirófano ni cómo se asigna el anestesiólogo.

## Acuerdo del juez con la calificación humana

| Criterio | Pares | Kappa ponderada | Spearman | Exacto | ±1 | Juez menos humano |
| --- | --- | --- | --- | --- | --- | --- |
| Todos | 32 | -0.02 [-0.08, 0.05] | -0.12 [-0.46, 0.22] | 9% [0%, 22%] | 38% [22%, 53%] | -1.78 [-2.09, -1.47] |
| Claridad | 8 | 0.03 [-0.02, 0.08] | 0.27 [-0.15, 0.77] | 12% [0%, 38%] | 38% [12%, 75%] | -1.50 [-1.88, -1.00] |
| Verificabilidad | 8 | -0.17 [-0.31, 0.00] | -0.58 [-1.00, -0.14] | 25% [0%, 50%] | 75% [38%, 100%] | -1.12 [-1.75, -0.50] |
| Completitud | 8 | 0.01 [0.00, 0.06] | 0.29 [0.14, 0.75] | 0% [0%, 0%] | 0% [0%, 0%] | -2.50 [-2.88, -2.12] |
| Consistencia | 8 | 0.05 [-0.04, 0.25] | 0.18 [-0.58, 0.74] | 0% [0%, 0%] | 38% [0%, 75%] | -2.00 [-2.62, -1.38] |

Intervalos al 95 % por bootstrap de los pares (2,000 remuestreos, semilla fija).

Distribución de los puntajes en esos pares:

| Quién | 1 | 2 | 3 | 4 | 5 | Media |
| --- | --- | --- | --- | --- | --- | --- |
| Juez | 0 | 14 | 15 | 3 | 0 | 2.66 |
| Persona | 0 | 0 | 2 | 14 | 16 | 4.44 |

Por modelo en la muestra humana (descriptivo, no concluyente):

| Modelo | Corridas | Juez | Persona |
| --- | --- | --- | --- |
| Anthropic · Claude Haiku 5.5 (tool) * | 3 | 2.83 | 4.58 |
| Groq · GPT-OSS 20B (native) | 3 | 2.75 | 4.25 |
| Ollama · Llama 3.1 8B (native) | 2 | 2.25 | 4.50 |

El orden de los modelos no coincide entre el juez y la persona.

## Acuerdo del emparejador con la revisión humana

100% [100%, 100%] de 10 emparejamientos revisados.

## Estabilidad: el juez y el emparejador contra sí mismos

| Quién | Pares | Kappa | Acuerdo exacto |
| --- | --- | --- | --- |
| Juez (puntaje por criterio, ponderada cuadrática) | 40 | 0.74 [0.59, 0.85] | 72% [57%, 85%] |
| Emparejador (detectado o no) | 25 | 0.91 [0.69, 1.00] | 96% [88%, 100%] |

\* El juez es del mismo proveedor que este modelo (posible autopreferencia).
