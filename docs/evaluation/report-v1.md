# Reporte de evaluación v1

CriterIA convierte un requerimiento en historias de usuario, criterios de aceptación y casos de prueba. Lo hace con cuatro agentes: Analista, QA, Revisor y un Evaluador que hace de juez. Este reporte compara tres modelos de generación con el mismo grafo, los mismos prompts (v1) y el mismo juez (v1), y mide cuánto se puede confiar en ese juez. El método completo, la configuración y las limitaciones están en [evaluation.md](../evaluation.md).

## Configuración

- **Casos.** 15 requerimientos en español: 5 fáciles, 5 medios y 5 difíciles con 5 problemas sembrados cada uno (ambigüedades, inconsistencias y faltantes).
- **Corridas.** Una corrida por caso y modelo. Las historias se aprueban sin cambios, y hay hasta 2 rondas de corrección del Revisor.
- **Generación.** Temperatura pedida de 0.2; Haiku la ignora. El tope es de 16,384 tokens para los modelos por API y de 8,192 para el local.
- **Juez.** `claude-haiku-5-5`, con una rúbrica de 1 a 5 en claridad, verificabilidad, completitud y consistencia, y severo por instrucción.
- **Validación.** Una persona calificó a ciegas 8 corridas (32 pares criterio por corrida). Un emparejador automático decide qué problemas sembrados detectó el Revisor, y la persona revisó 10 de sus decisiones.

| Modelo | Modo de salida | Tope de tokens | Dónde corre |
| --- | --- | --- | --- |
| Anthropic · Claude Haiku 5.5 * | `tool` | 16,384 | API |
| Groq · GPT-OSS 20B | `native` | 16,384 | API; es el modelo del modo gratuito |
| Ollama · Llama 3.1 8B | `native` | 8,192 | RTX 4060 de 8 GB, tiempo límite de 180 s |

\* El juez es del mismo proveedor que este modelo.

## Métricas principales

Son las métricas que no dependen del juez.

| Modelo | Problemas detectados | Completas | Válidas a la primera | Latencia p50 | Latencia p95 | Costo por corrida (USD) |
| --- | --- | --- | --- | --- | --- | --- |
| Haiku 5.5 * | 13 de 25 (52%) | 15 de 15 | 97% | 148 s | 207 s | 0.0296 |
| GPT-OSS 20B | 8 de 25 (32%) | 14 de 15 | 96% | 33 s | 61 s | 0.0089 |
| Llama 3.1 8B | 1 de 15 (7%) † | 11 de 15 | 90% | 329 s | 476 s | 0.0015 (solo juez) |

- **Detección por tipo de problema:**

  | Tipo | Haiku | GPT-OSS |
  | --- | --- | --- |
  | Ambigüedades | 5 de 7 | 1 de 7 |
  | Inconsistencias | 4 de 6 | 4 de 6 |
  | Faltantes | 4 de 12 | 3 de 12 |

- **Problemas que nadie detectó:** 9 de 25, y 7 de ellos son faltantes.
- **Corridas incompletas de Llama:** las 4 son tiempos agotados.
- **Costo de GPT-OSS:** es un mínimo, porque los rechazos de Groq no devuelven uso.
- **Fiabilidad del emparejador:** confirmado en 10 de 10 decisiones revisadas, con un intervalo exacto de 69 % a 100 %, y estable consigo mismo al 96 %.

† Llama cubre 3 de los 5 casos difíciles, así que su tasa no es directamente comparable con las otras dos. En esos 3 casos, Haiku detecta 9 de 15 y GPT-OSS 4 de 15.

## Puntajes del juez (secundarios)

| Modelo | Global (todas) | Global (11 comunes) | Claridad | Verificabilidad | Completitud | Consistencia |
| --- | --- | --- | --- | --- | --- | --- |
| Haiku 5.5 * | 2.73 | 2.70 | 3.00 | 2.87 | 2.47 | 2.60 |
| GPT-OSS 20B | 2.82 | 2.82 | 3.07 | 3.07 | 2.50 | 2.64 |
| Llama 3.1 8B | 2.05 | 2.05 | 2.18 | 2.18 | 2.00 | 1.82 |

![Puntaje medio del juez por criterio y modelo, de 1 a 5](criterios-v1.svg)

## ¿Cuánto se puede confiar en el juez?

| Medida | Valor (IC 95 %) |
| --- | --- |
| Juez contra persona: kappa ponderada (32 pares) | -0.02 (-0.08 a 0.05) |
| Juez contra persona: Spearman | -0.12 (-0.46 a 0.22) |
| Acuerdo exacto / a ±1 punto | 9% / 38% |
| Juez menos persona, en promedio | -1.78 puntos (-2.09 a -1.47) |
| Juez contra sí mismo al recalificar 10 corridas (kappa / exacto) | 0.74 / 72% |

**Consistente pero no validado.**
- **Consistente:** el juez repite sus puntajes con bastante estabilidad.
- **No validado:** contra la persona no hay acuerdo a nivel de corrida.
- **Distribuciones:**
  - Las 8 corridas le parecieron de buena calidad a la persona, y le costó distinguirlas: 30 de sus 32 puntajes son 4 o 5 (efecto techo).
  - El juez usa casi solo 2 y 3, unos dos puntos por debajo.
- **Causas probables del desfase:**
  - La instrucción de calibración del juez v1: «un 5 es excepcional; si dudas, elige el menor».
  - Una escala sin anclas por nivel.
- **Cómo leer los puntajes:** las diferencias se leen con cautela, y la de Haiku contra GPT-OSS es menor que la variación del juez.

| Por modelo en la muestra (descriptivo) | Corridas | Juez | Persona |
| --- | --- | --- | --- |
| Haiku 5.5 * | 3 | 2.83 | 4.58 |
| GPT-OSS 20B | 3 | 2.75 | 4.25 |
| Llama 3.1 8B | 2 | 2.25 | 4.50 |

- **El orden coincide solo en el primer lugar.** El juez pone a Llama al final, y la persona lo pone segundo.
- **No es concluyente.** Con 2 o 3 corridas por modelo y diferencias de décimas, esto no ordena los modelos.
- **Impresión del evaluador.** Como evaluador, percibió al modelo local como el menos claro, pero sus puntajes a ciegas no lo reflejan: dio 4.5 en claridad a Llama y 4.33 a los otros dos.

## Conclusiones

1. **Revisión.** Haiku detecta más problemas sembrados que GPT-OSS (52 % contra 32 %), sobre todo ambigüedades. Con 25 problemas, la diferencia es indicativa, no concluyente. Los faltantes son el punto débil de los tres modelos: ninguno detectó 7 de los 12.
2. **Velocidad y costo.** GPT-OSS 20B es 4.5 veces más rápido y 3.3 veces más barato por corrida que Haiku, con robustez similar. Es la elección correcta para el modo gratuito.
3. **Modelo local.** Llama 3.1 8B queda detrás en detección, robustez y velocidad. Es una opción sin costo de generación, no un equivalente.
4. **Puntajes del juez.** Haiku y GPT-OSS quedan parejos, y Llama más abajo. Como el juez no está validado, estas diferencias son secundarias.

## Limitaciones

- **Casos:** 15, con una corrida cada uno, escritos por el autor del proyecto.
- **Juez:** uno solo, del mismo proveedor que Haiku, consistente pero no validado contra una persona.
- **Validación humana:** un solo calificador, que es el autor, con 8 corridas y efecto techo.
- **Modelo local:** completó 11 de 15 corridas por su tiempo límite y usa un tope de tokens menor.

## Siguiente versión

La v2 cambiará solo los prompts de los agentes y se comparará contra v1 únicamente con Haiku y GPT-OSS 20B, de forma pareada (Wilcoxon). El método cambia en tres puntos:
- **Rúbrica:** con anclas por nivel, la misma para todos los modelos, y un juez calibrado con ellas.
- **Juez:** si cambia, se recalifican también los artefactos guardados de v1, para comparar con el mismo juez.
- **Calificación humana:** se hace en una página HTML por corrida, con al menos dos calificadores.

Costo real de la fase: unos 1.24 USD. De ese total, 0.62 USD corresponden a los resultados que se reportan aquí; el resto se fue en lotes descartados por ajustes de integración y en diagnósticos.
