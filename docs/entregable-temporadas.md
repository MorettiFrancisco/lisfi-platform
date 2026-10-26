# Temporadas — 26 de octubre de 2026

Los administradores de liga con MFA pueden crear temporadas en borrador, activarlas
y cerrarlas. La consulta y el historial están disponibles para usuarios autenticados;
los representantes no pueden modificar temporadas. La lista tiene filtros y paginación.

Cada cambio se registra en auditoría dentro de la misma operación de base de datos.
Las transiciones requieren el estado anterior esperado, por lo que una edición
concurrente obsoleta recibe un conflicto sin duplicar la auditoría. Las temporadas
cerradas siguen consultables. No se impone unicidad global de temporada activa: el
contexto competitivo y la regla de simultaneidad siguen pendientes de definición.

Las capturas de pantalla usan información ficticia de una prueba aislada. El alta del
segundo administrador y las invitaciones de representantes continúan pendientes.
