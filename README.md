# PetCare

Aplicación Ionic/Angular para registrar cuidados de mascotas, conservar registros pendientes en el navegador y demostrar su sincronización. Incluye una pantalla de ubicación y mapa, además de vistas de demostración para collar, sensores, NFC y alertas.

## Requisitos

- Node.js compatible con Angular CLI 22.0.1: `^22.22.3 || ^24.15.0 || >=26.0.0`.
- npm.

## Instalar y ejecutar

Desde la carpeta del proyecto:

~~~powershell
cd C:\Users\sting\Desktop\veterinaria\PetCare
npm install
npm start
~~~

Si clonaste el repositorio en otra ubicación, ajusta la ruta.

Abre [http://localhost:4200](http://localhost:4200). `npm start` ejecuta `ng serve` y arranca únicamente la aplicación Angular. La pantalla actual utiliza un endpoint externo de demostración para sincronizar cuidados; no requiere iniciar la API local.

Los scripts `start:app` y `server` no están definidos en `package.json`. El archivo `dev.mjs` intenta ejecutar `start:app`, por lo que tampoco es un método de inicio operativo con la configuración actual.

## Estado de red

La pantalla `HomePage` utiliza `Network.getStatus()` y el evento `networkStatusChange` de `@capacitor/network`.

La aplicación inicia en **modo demostración**:

- **En línea**: simula el estado conectado e intenta enviar los registros pendientes.
- **Offline**: simula el estado desconectado y permite guardar registros localmente.
- **Red real**: utiliza el estado reportado por Capacitor y sus cambios posteriores.

El modo demostración controla el estado mostrado y el inicio de los envíos; las peticiones HTTP siguen necesitando una conexión real. El estado de red reportado tampoco garantiza que el servidor responda.

## Guardado y sincronización de cuidados

El formulario de cuidados está en la vista de historial.

1. El usuario introduce el nombre de la mascota y el cuidado realizado.
2. La pantalla crea el registro y lo guarda primero en la cola local.
3. Si el estado de la pantalla es «en línea», intenta enviar los pendientes en orden mediante `POST` a `https://jsonplaceholder.typicode.com/posts`.
4. Cuando una respuesta HTTP es correcta, elimina ese registro de la cola.
5. Si un envío falla, conserva ese registro y los siguientes, y detiene el intento.

La pantalla intenta sincronizar al guardar un cuidado estando en línea, al pulsar el botón de sincronización, al seleccionar **En línea** en modo demostración y al recibir un cambio de red conectado en modo real con registros pendientes.

Seleccionar **Red real** actualiza el estado mostrado, pero no inicia por sí solo una sincronización. La implementación de la pantalla no tiene reintentos periódicos cada 15 segundos.

El destino actual es un servidor de demostración. Un envío correcto desde esta pantalla no guarda el registro en la API local ni en `data/care-records.json`.

### Persistencia local

La cola utilizada por la pantalla se guarda en `localStorage` bajo la clave:

~~~text
petcare-pendientes
~~~

Cada registro contiene:

| Campo | Contenido |
| --- | --- |
| `id` | Identificador con formato `PET-` seguido de la marca de tiempo. |
| `tipo` | Texto «Cuidado de» seguido del nombre de la mascota. |
| `detalle` | Descripción del cuidado. |
| `fecha` | Fecha de creación en formato ISO. |

El cuerpo enviado añade `mascota: 'Luna'` y `aplicacion: 'PetCare'`; actualmente el campo `mascota` enviado está fijado en el código.

Los pendientes se recuperan desde el almacenamiento del navegador al abrir la pantalla. Borrar los datos del sitio elimina esa cola. Este almacenamiento permite conservar registros mientras la aplicación está cargada; el proyecto no configura un service worker para garantizar que la aplicación web pueda abrirse o recargarse sin conexión.

### Servicios adicionales presentes en el repositorio

`ConnectivityService` y `CareRecordService` existen, pero no están integrados en la pantalla actual:

- `ConnectivityService` utiliza `navigator.onLine` y los eventos `online` y `offline`, y expone la signal `isOnline`.
- `CareRecordService` utiliza `environment.apiUrl`, guarda su propia cola en `petcare.pending-care-records` y programa reintentos a los 15 segundos mientras hay pendientes y el estado indica conexión.
- Sus registros contienen `id`, `petName`, `description` y `createdAt`; la cola añade `queuedAt`.

Estas características pertenecen a los servicios y no describen el flujo activo de `HomePage`.

## API local opcional

El repositorio incluye `server.mjs`, una API de desarrollo independiente. Para iniciarla, ejecuta en otra terminal desde la raíz del proyecto:

~~~powershell
node server.mjs
~~~

Por defecto muestra `PetCare API ready at http://localhost:3000`. El puerto puede cambiarse mediante la variable de entorno `PORT`.

| Método y ruta | Función |
| --- | --- |
| `GET /health` | Responde con estado HTTP 200 y `{"status":"ok"}`. |
| `GET /api/care-records` | Devuelve los registros guardados. |
| `POST /api/care-records` | Recibe un registro con `id`, `petName`, `description` y `createdAt`, todos cadenas no vacías. |

Los registros aceptados se guardan en `data/care-records.json`, archivo ignorado por Git. La API evita duplicados por `id`.

Para comprobar que responde:

~~~powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health
~~~

### Configuración de los servicios

Los archivos de entorno definen los endpoints utilizados por `CareRecordService`:

| Entorno | `apiUrl` |
| --- | --- |
| Desarrollo | `http://localhost:3000/api/care-records` |
| Producción | `/api/care-records` |

La ruta de producción necesita un backend que la atienda. Cambiar estos valores no modifica el endpoint utilizado por `HomePage`, que está escrito directamente en la pantalla. Para conectar el formulario con la API local también es necesario adaptar los campos enviados o integrar `CareRecordService`.

## Probar el modo offline

### Con los controles de demostración

1. Inicia la aplicación con `npm start`.
2. Pulsa **Offline** en la barra de demostración.
3. Abre el historial, completa el formulario y guarda un cuidado.
4. Comprueba el contador y la clave `petcare-pendientes` en **Application > Local Storage** de DevTools.
5. Con conexión real disponible, pulsa **En línea**.
6. Si el servidor de demostración responde correctamente, se eliminan los registros enviados y el contador llega a cero.

### Con el estado real del navegador

1. Pulsa **Red real** antes de probar la desconexión.
2. En DevTools, abre **Network** y cambia **No throttling** a **Offline**.
3. Registra un cuidado y comprueba que permanece en la cola local.
4. Vuelve a **No throttling**. Cuando la pantalla reciba el cambio a conectado, intentará enviar los pendientes.
5. Si el envío falla, comprueba la conexión y utiliza el botón de sincronización. No hay un temporizador de reintento en esta pantalla.

### Solución de problemas

- **El aviso no cambia al desconectar la red:** selecciona **Red real**; el modo demostración mantiene el estado elegido manualmente.
- **Los registros siguen pendientes:** revisa la petición a `jsonplaceholder.typicode.com/posts` en DevTools y vuelve a sincronizar cuando el destino esté disponible.
- **La API local no recibe los cuidados:** la pantalla actual envía al servidor externo de demostración.
- **`npm run server` o `npm run start:app` indica que falta el script:** utiliza `node server.mjs` para la API opcional y `npm start` para la aplicación.
- **El puerto está ocupado:** detén el proceso que utiliza el puerto antes de volver a iniciar el componente correspondiente.

## Ubicación y funciones de demostración

La ruta `/location` incluye geolocalización mediante Capacitor, un mapa Leaflet con teselas de OpenStreetMap, búsqueda de ubicaciones mediante Nominatim, consulta de lugares cercanos mediante Overpass y una acción para compartir la ubicación con Capacitor Share. Su disponibilidad depende de los permisos y las capacidades del dispositivo; los recursos externos del mapa y las búsquedas requieren conexión.

En `HomePage`, la búsqueda y conexión Bluetooth, la lectura NFC y la preparación del expediente para compartir son simulaciones de interfaz. Las alertas iniciales también son datos de demostración.

## Archivos principales

| Archivo | Responsabilidad |
| --- | --- |
| `src/app/home/home.page.ts` | Estado de red, modo demostración, cola local y envíos utilizados por la pantalla. |
| `src/app/home/home.page.html` | Vistas, formulario, controles de conexión y contador. |
| `src/app/home/home.page.scss` | Estilos de la pantalla principal. |
| `src/app/location/location.page.ts` | Geolocalización, mapa y acción para compartir ubicación. |
| `src/app/services/places.ts` | Consultas de ubicaciones y lugares cercanos. |
| `src/app/services/connectivity.service.ts` | Servicio de conectividad separado de la pantalla actual. |
| `src/app/services/care-record.service.ts` | Servicio de cola y sincronización separado de la pantalla actual. |
| `src/environments/environment.ts` | Endpoint de desarrollo para `CareRecordService`. |
| `src/environments/environment.prod.ts` | Endpoint de producción para `CareRecordService`. |
| `server.mjs` | API local opcional y persistencia en archivo JSON. |

## Comandos de validación

~~~powershell
npm run build -- --configuration development
npm run build
npm test -- --watch=false
npm run lint
~~~

Estos comandos permiten comprobar la compilación de desarrollo, la compilación de producción, las pruebas y el análisis estático. Esta actualización de documentación se contrastó con el código y la configuración; no certifica que esos comandos se hayan ejecutado correctamente.
