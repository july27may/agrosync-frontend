# Validación de captura offline de café

Ejecutada el 19 de noviembre de 2026.

## Instalación real

- El backend se reconstruyó mediante Compose y pasaron 17 pruebas JUnit.
- Actuator y las rutas de catálogos respondieron desde el backend local. SuiteCRM devolvió La Quiebra, una página sin lotes para esa finca y un contacto seleccionable. No se incluyeron nombres de contactos en esta evidencia.
- Chromium cargó el frontend, descargó los catálogos reales y mostró el aviso de ausencia de lotes al seleccionar La Quiebra. El origen `http://127.0.0.1:5173` pasó el preflight CORS. El preflight de `http://localhost:5173` recibió 403.

## Captura y recuperación con catálogos de prueba

El build de producción pasó TypeScript y Vite. Una prueba Playwright con Chromium verificó:

1. Descarga inicial de catálogos paginados y activación del service worker.
2. Desconexión de red del contexto de Chromium y selección de lote filtrada por finca.
3. Bloqueo de cantidad cero. Guardado de 2,500 kg a 1.500,00 COP/kg y cálculo de 3.750,00 COP para la semana y el recolector.
4. Escritura en IndexedDB del registro y la operación con identificadores distintos. Una colisión forzada en la operación abortó la transacción completa.
5. Cierre del contexto de navegador y apertura de un contexto nuevo con el mismo perfil, todavía sin red. La página cargó, recuperó la recolección y su operación y mostró **Pendiente de sincronizar**.

## Pendiente

Repetir el recorrido con los catálogos reales cuando La Quiebra tenga un lote disponible. El envío de operaciones y la confirmación por SuiteCRM corresponden al siguiente incremento.

## Autenticación en la prueba offline

Playwright comprobó el formulario de ingreso, el rechazo de una contraseña incorrecta, la descarga con sesión y la preparación explícita del dispositivo mediante un permiso ECDSA simulado. Después de desconectar y reabrir Chromium con el mismo perfil, recuperó el registro y la operación pendiente. Al adelantar el reloj más allá de las 24 horas y recargar sin red, reapareció el login y ambos datos siguieron en IndexedDB. La API Java y el alcance de permisos se probaron por separado con Spring Security y con un contenedor aislado conectado a SuiteCRM real.

Antes de usar el flujo con personal de campo, el operador debe aprovisionar cuentas en el backend, confirmar la matriz de perfiles y asignar las fincas. La instalación real sigue sin lotes para La Quiebra.

## Inicio de sesión delegado en SuiteCRM

El botón de ingreso en React llegó al formulario real de SuiteCRM sin pedir una contraseña en React. Playwright simuló el retorno del proveedor y verificó que la misma persona solo puede registrar en la finca donde tiene perfil Registrador. Se comprobó también la continuidad sin red y la conservación de los pendientes al vencer el permiso. El retorno real con un usuario asignado queda pendiente de las membresías aprobadas.

## Vigencia configurable y conservación de pendientes

La prueba de Chromium usó un permiso firmado de 90 minutos. Cerró y reabrió sin red con el mismo permiso, adelantó el reloj hasta el vencimiento y comprobó que la aplicación bloqueó el acceso y conservó IndexedDB. Al simular la reconexión y el retorno de la sesión con los permisos vigentes, la aplicación recuperó la misma recolección y operación en estado pendiente. La prueba usó catálogos y autorización de prueba para medir el tiempo y el almacenamiento. La evidencia de credenciales reales se encuentra en la validación del backend.

## Conflictos y acuses

Chromium comprobó el reintento de un pendiente con una primera respuesta de fallo, seguida de un acuse simulado con el UUID correcto. El fallo conservó tanto la recolección como la operación. Solo el acuse cambió su estado en IndexedDB. La creación e idempotencia reales se verificaron en una copia aislada de SuiteCRM, sin enviar los pendientes del navegador del usuario.

SuiteCRM activo confirmó posteriormente dos cosechas distintas de La Quiebra, creadas por admin y asociadas a su grupo de seguridad. La aplicación conserva los registros históricos locales al confirmar operaciones.

## Ganadería offline

Chromium se ejecutó con perfiles y datos de prueba. El escenario ganadero usó `PRUEBA-MADRE`, `PRUEBA-CRIA` y `Revisión de prueba`. Verificó la edad desconocida, la captura mientras estaba desconectado, el cierre y la reapertura sin red, y las relaciones de madre y evento. Después simuló la pérdida del primer acuse y confirmó que el reintento enviaba la madre antes de la cría y el evento, con tres IDs únicos.

La prueba de Café pasó de nuevo. Los datos del navegador de prueba no se enviaron al CRM activo. Las escrituras nativas de los mismos tipos se comprobaron por separado en la copia aislada. Queda pendiente el primer uso productivo con datos reales.

**Resultado final: 3 pruebas de Chromium aprobadas.** Además del recorrido ganadero y la regresión de Café, la prueba de migración arrancó con una base IndexedDB v1 sembrada con una recolección y su operación pendiente de prueba. La versión 2 agregó dos almacenes y conservó ambos datos y el estado pendiente.

## Liquidación por finca y semana

Chromium comprobó dos fincas y dos semanas con datos de prueba. Verificó el total de la finca y los subtotales de dos recolectores, un registro que existía tanto en SuiteCRM como en IndexedDB y otro pendiente local. Cambiar el recolector de captura no filtró la tabla ni el importe. Al ir sin conexión se consultaron las descargas previas. Las seis pruebas de frontend pasaron.
