# Consulta de actividad — 26 de octubre de 2026

La administración de liga con MFA puede consultar la actividad registrada de
clubes, solicitudes y temporadas. La pantalla permite filtrar por tipo y por rango
de fechas UTC, y paginar resultados. Cada entrada muestra acción, actor, fecha,
recurso y referencia; los nombres se consultan en su estado actual. Las acciones
sobre un mismo recurso pueden compartir el mismo instante y, en ese caso, el
orden se desempata por identificador, no necesariamente por orden causal.

En cambios de clubes se muestran únicamente diferencias de nombre, nombre corto,
identificador y estado; en transiciones de temporada, su estado anterior y nuevo.
La API no devuelve los metadatos completos de auditoría ni los datos personales de
jugadores. La consulta requiere rol activo y MFA verificado en cada solicitud.
Los registros históricos dependen de los eventos que ya se hayan implementado;
esta pantalla no agrega retrospectivamente eventos faltantes.

Las capturas se generan con datos ficticios en una base temporal. La migración
0006 agrega un índice para la lectura por fecha sin alterar registros existentes.
