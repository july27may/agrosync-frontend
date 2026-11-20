# AgroSync Frontend

Consulta la [matriz RF01–RF12 y los resultados del prototipo](https://github.com/july27may/agrosync-suitecrm/blob/main/docs/validacion-rf01-rf12.md).

Captura local de recolecciones de café con React, TypeScript, IndexedDB y un service worker. El backend se usa para descargar catálogos. Las recolecciones y sus operaciones quedan pendientes en el navegador.

## Ejecutar y preparar la aplicación

Desde el [backend](../agrosync-backend/README.md), ejecuta `docker compose up -d --build`. El backend atiende en `http://127.0.0.1:8081`.

Desde este directorio, con Node.js 22.12 o posterior:

```bash
npm ci
npm run build
npm run start
```

1. Usa una cuenta de SuiteCRM con grupos y roles AgroSync asignados. Abre **http://127.0.0.1:5173/** con conexión y pulsa **Ingresar con SuiteCRM**. Conserva esta URL exacta en cada visita, ya que el almacenamiento y el service worker pertenecen al origen del navegador.
2. Tras iniciar sesión con conexión, la preparación arranca automáticamente. Espera **Listo para trabajar sin conexión**. La barra indica desde cuándo está lista y hasta cuándo es válida la autorización. Para Café, confirma que tu finca tiene un lote seleccionable y que aparecen los contactos. Usa **Actualizar datos offline** si necesitas refrescar los datos y renovar la autorización de forma explícita.
3. Desconecta la red, selecciona finca, lote y recolector y guarda una recolección. Cierra y vuelve a abrir la aplicación desde el mismo perfil para recuperar las recolecciones. El navegador debe conservar sus datos del sitio.
4. La captura guarda el registro y su operación en la misma transacción, con UUID independientes para el registro y `operationId`. Los estados visibles quedan en **Guardado localmente** y **Pendiente de sincronizar**. La cola se envía al guardar con conexión, al abrir en línea con pendientes o al reconectar.

La preparación reúne tres pasos. **Actualizar datos offline** descarga los catálogos base paginados de fincas, lotes y contactos y los guarda en IndexedDB. Al abrir la aplicación, el service worker guarda HTML, JavaScript y CSS en su caché y React espera a que controle la página. Java emite por separado la autorización offline firmada, después de verificar la sesión y los permisos en SuiteCRM. La preparación conserva una autorización vigente en los arranques automáticos y el botón permite renovarla con conexión. Abre Ganadería, Inventario y el tipo de registro que necesites, además de las semanas que quieras consultar, para descargar sus datos específicos antes de desconectarte. En loopback funciona por HTTP. Fuera de loopback el service worker requiere HTTPS. El backend autoriza mediante CORS solo el origen configurado en `AGROSYNC_FRONTEND_ORIGIN`. Si se cambia la URL del backend, define `VITE_API_BASE_URL` antes de compilar.

## Organización

- `src/app` compone la vista y su estado general.
- `src/features/auth` gestiona login, sesión y autorización offline del dispositivo.
- `src/features/catalogos` descarga y persiste fincas, lotes y contactos.
- `src/features/recolecciones` gestiona el formulario, el listado y la transacción de guardado.
- `src/features/liquidacion` calcula y muestra el estimado semanal por recolector.
- `src/shared` contiene la apertura de IndexedDB, paginación HTTP, formateo y estado offline.
- `scripts/service-worker.mjs` genera una versión del caché basada en los recursos del build.

La liquidación usa semanas de lunes a domingo según la fecha de recolección. Multiplica gramos por centavos por kilogramo con enteros y redondea a centavos el subtotal semanal de cada recolector. Acepta coma o punto decimal, con hasta tres decimales de peso y dos de tarifa.

## Sesión y datos locales

La vigencia del permiso del dispositivo la define el backend con `AGROSYNC_OFFLINE_TTL`. El valor actual es 24 horas desde la preparación y debe validarse con la finca. Reabrir la aplicación sin red no renueva el permiso. El perfil Consulta puede consultar sus registros locales autorizados. Administrador de finca y Registrador pueden capturar dentro de sus fincas asignadas. IndexedDB separa catálogos, registros y operaciones por el ID estable de la cuenta. Los registros de la versión anterior sin cuenta asociada se conservan y requieren una asignación explícita en un incremento posterior. Al cerrar sesión se retira el permiso offline de este navegador. Al vencer el permiso se pide iniciar sesión y se conservan los pendientes. SuiteCRM recibe la contraseña en su formulario. Java mantiene los tokens delegados y los secretos de integración del lado servidor.

## Pruebas

```bash
npm run build
npx playwright install chromium
npm test
```

También puedes ejecutar `CHROME_PATH=/usr/bin/google-chrome npm test` si ya tienes Chrome. La prueba inicia el sitio si falta, utiliza catálogos rotulados como datos de prueba y crea un perfil temporal propio. Consulta [VALIDACION.md](VALIDACION.md).

## Enviar recolecciones pendientes

Guardar una creación o corrección en Café, Ganadería, Inventario o Registros inicia el envío cuando hay conexión. La cola también se intenta al abrir AgroSync en línea y al reconectar con la aplicación abierta. Si guardas durante otro envío, el coordinador revisa los nuevos pendientes en cuanto termina. Antes de escribir, React consulta la sesión y los permisos vigentes en Java, y Java vuelve a comprobarlos al recibir cada operación. **Sincronizar ahora** ejecuta el mismo recorrido bajo demanda. Los envíos comparten un único coordinador y un bloqueo entre pestañas en navegadores compatibles con Web Locks. Se mantienen los UUID y los acuses de SuiteCRM. Un fallo, conflicto o sesión vencida deja el registro pendiente. Las incidencias que requieren intervención se pueden consultar en **Incidencias**. La sincronización automática funciona mientras la aplicación está abierta.

## Captura ganadera offline

1. Inicia sesión con SuiteCRM en `http://127.0.0.1:5173/`. En la navegación superior, abre **Ganadería** y selecciona la finca.
2. Mientras tengas conexión, deja cargar los animales, eventos y catálogos. Espera a que aparezcan los animales y eventos y comprueba la vigencia en la barra de preparación. Puedes alternar con **Café** desde el mismo origen y perfil de navegador.
3. Registra animales y eventos sin conexión. La fecha de nacimiento es opcional y la edad se calcula al consultar. Las referencias a madre y animal se conservan aunque ambos estén pendientes.
4. Al reconectar se envía la cola automáticamente. También puedes pulsar **Sincronizar ahora**. Primero se confirma la madre, luego la cría y finalmente los eventos que dependan de ese animal. Si la respuesta se pierde o un registro falla, lo pendiente se conserva y se puede reintentar con el mismo UUID.
5. Los estados confirmados corresponden a acuses de SuiteCRM. Administrador de finca puede crear animales y eventos, Registrador puede crear eventos y Consulta solo puede leer. Java vuelve a verificar ese alcance al sincronizar.

`src/features/ganaderia` contiene el cálculo de edad, la interfaz, la persistencia y el envío. IndexedDB conserva los almacenes de Café y agrega los de animales y eventos en la versión 2. Ambos módulos comparten la cola de operaciones, con tipos distintos.

## Consulta semanal de Café

Selecciona **Finca de consulta** y cualquier fecha de la semana. El periodo abarca de lunes a domingo. La tabla y la liquidación comparten la misma selección. Al cambiar la finca del formulario también se actualiza la finca consultada. El recolector del formulario solo se usa para la captura. En la tabla puedes elegir 5, 10, 20 o 50 registros por página. La paginación conserva el total semanal y el CSV incluye todas las páginas de la consulta.

La consulta combina las cosechas de SuiteCRM con los pendientes de ese dispositivo dentro de la finca y semana. Si una operación local ya está en SuiteCRM, su ID central evita contarla dos veces. El total de la finca suma los subtotales semanales de todos los recolectores. Abre con conexión las semanas que necesites consultar offline. Sin una descarga previa, la vista indica que el total disponible se limita a los datos de ese dispositivo.


## Bitácora central

En **Incidencias → Bitácora central**, selecciona una finca y, si quieres buscar una operación exacta, introduce su UUID. Con conexión puedes ver los eventos desde cualquier dispositivo que tenga una sesión y permisos para esa finca. La sección **Incidencias de este dispositivo** conserva el historial local, también disponible sin red. Una resolución guardada sin conexión se envía al recuperar la sesión y la red.
