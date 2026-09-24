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

Abre [http://localhost:4200](http://localhost:4200). `npm start` inicia Angular y la API local en el puerto 3000. Si ya tenías la aplicación ejecutándose con la configuración anterior, detén ese proceso y vuelve a ejecutar `npm start`.

También puedes iniciar ambos procesos por separado, en dos terminales:

~~~powershell
npm run server
npm run start:app
~~~

## Estado de red

`ConnectivityService` comparte el estado entre la pantalla y la cola de sincronización. Utiliza los eventos del navegador y el estado de Capacitor recibido por `HomePage`.

- **Red real**: es el modo inicial cuando no existe una selección de demostración guardada. Envía los pendientes al recuperar conexión o al seleccionar este modo estando conectado.
- **En línea**: simula conexión e intenta enviar los pendientes.
- **Offline**: simula desconexión y conserva los registros localmente, aunque el navegador tenga internet.

La selección de demostración se conserva al recargar. Seleccionar **Red real** elimina esa selección guardada. El modo demostración controla cuándo se intenta enviar; la API todavía debe estar accesible para completar un envío.

## Guardado y sincronización de cuidados

El formulario del historial utiliza `CareRecordService`:

1. Valida el nombre de la mascota y la descripción.
2. Guarda el cuidado en la cola local **antes** de iniciar la petición.
3. Cuando hay conexión, envía los pendientes en orden al endpoint de `environment.apiUrl`.
4. Elimina cada pendiente únicamente después de una respuesta HTTP correcta.
5. Si la API falla o tarda más de **10 segundos**, conserva los pendientes, muestra el error y libera el botón.
6. Reintenta cada **15 segundos** mientras hay pendientes y conexión, además de sincronizar al recuperar la red y al pulsar **Sincronizar ahora**.

El contador, el botón y los mensajes se actualizan mediante signals, también cuando una petición termina sin otra interacción del usuario. Los envíos concurrentes comparten una sola operación de sincronización.

Los cuidados se guardan realmente en `data/care-records.json` mediante la API local. La pantalla ya no utiliza JSONPlaceholder. Los elementos de ejemplo del historial siguen siendo demostrativos; los cuidados enviados pueden consultarse en `GET /api/care-records`.

### Persistencia y recuperación de pendientes

La cola está en `localStorage` bajo la clave `petcare.pending-care-records`. Contiene `id`, `petName`, `description`, `createdAt` y `queuedAt`.

Al iniciar, el servicio incorpora los pendientes del formato anterior (`petcare-pendientes`) a esta cola, conserva sus identificadores y evita duplicados por `id`. Solo elimina la copia anterior después de guardar la cola combinada. Si encuentra datos no convertibles o falla el almacenamiento, conserva esos datos y muestra un aviso.

Borrar los datos del sitio elimina la cola local. El proyecto no configura un service worker para garantizar la apertura o recarga de la web sin conexión.

## API local

`npm start` inicia `server.mjs` automáticamente. Por defecto escucha en `http://localhost:3000`. El puerto puede cambiarse mediante `PORT`; si lo cambias, ajusta también `environment.apiUrl`.

| Método y ruta | Función |
| --- | --- |
| `GET /health` | Devuelve `{"status":"ok"}`. |
| `GET /api/care-records` | Devuelve los cuidados guardados. |
| `POST /api/care-records` | Guarda un cuidado con `id`, `petName`, `description` y `createdAt`. |

Los registros aceptados se guardan en `data/care-records.json`, ignorado por Git. La API evita duplicados por `id`.

~~~powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health
~~~

| Entorno | `apiUrl` |
| --- | --- |
| Desarrollo | `http://localhost:3000/api/care-records` |
| Producción | `/api/care-records` |

En producción debes servir esa ruta con un backend. En un dispositivo físico, `localhost` se refiere al propio dispositivo: configura la dirección accesible del equipo que ejecuta la API.

## Probar el modo offline

1. Inicia la aplicación y la API con `npm start`.
2. Pulsa **Offline**, abre el historial y guarda un cuidado.
3. Comprueba que aparece pendiente y que no se envía todavía.
4. Pulsa **En línea** o **Red real** con la API accesible.
5. Comprueba que el contador llega a cero, el botón vuelve a estar disponible y aparece el mensaje de sincronización completada.
6. Consulta `http://localhost:3000/api/care-records` para verificar el registro persistido.

Para comprobar los reintentos, inicia aplicación y API por separado, detén solo la API y guarda un cuidado estando en línea. El registro debe mantenerse pendiente. Reinicia la API: se enviará en un próximo reintento sin cambiar de red.

### Solución de problemas

- **El aviso no cambia al desconectar la red:** selecciona **Red real**.
- **Los registros siguen pendientes:** comprueba `/health` y la petición a `/api/care-records` en DevTools; el indicador de conexión no garantiza que la API responda.
- **La aplicación ya estaba abierta antes de esta corrección:** reinicia con `npm start` para arrancar también la API, o ejecuta `npm run server` en otra terminal.
- **El puerto está ocupado:** detén el proceso anterior antes de volver a iniciar el mismo componente.

## Ubicación y funciones de demostración

La ruta `/location` incluye geolocalización mediante Capacitor, un mapa Leaflet con teselas de OpenStreetMap, búsqueda de ubicaciones mediante Nominatim, consulta de lugares cercanos mediante Overpass y una acción para compartir la ubicación con Capacitor Share. Su disponibilidad depende de los permisos y las capacidades del dispositivo; los recursos externos del mapa y las búsquedas requieren conexión.

En `HomePage`, la búsqueda y conexión Bluetooth, la lectura NFC y la preparación del expediente para compartir son simulaciones de interfaz. Las alertas iniciales también son datos de demostración.

## Archivos principales

| Archivo | Responsabilidad |
| --- | --- |
| `src/app/home/home.page.ts` | Interfaz de cuidados conectada a los servicios de red y sincronización. |
| `src/app/home/home.page.html` | Vistas, formulario, controles de conexión y contador. |
| `src/app/home/home.page.scss` | Estilos de la pantalla principal. |
| `src/app/location/location.page.ts` | Geolocalización, mapa y acción para compartir ubicación. |
| `src/app/services/places.ts` | Consultas de ubicaciones y lugares cercanos. |
| `src/app/services/connectivity.service.ts` | Estado compartido de red real y modo demostración. |
| `src/app/services/care-record.service.ts` | Cola persistente, migración, timeout y reintentos de sincronización. |
| `src/environments/environment.ts` | Endpoint de desarrollo para `CareRecordService`. |
| `src/environments/environment.prod.ts` | Endpoint de producción para `CareRecordService`. |
| `server.mjs` | API local y persistencia en archivo JSON. |

## Comandos de validación

~~~powershell
npm run build -- --configuration development
npm run build
npm test -- --watch=false
npm run lint
~~~

Estos comandos permiten comprobar la compilación de desarrollo, la compilación de producción, las pruebas y el análisis estático. Las pruebas de cuidados verifican también la actualización visual sin interacciones adicionales, los fallos de red, la recuperación de pendientes y los reintentos.
