# PetCare

Aplicacion Ionic/Angular para registrar cuidados de mascotas con soporte de conectividad y trabajo sin internet.

## Requisitos

- Node.js y npm.
- Dependencias instaladas con `npm install`.

## Ejecutar la aplicacion

~~~powershell
cd C:\Users\sting\Desktop\clone\PetCare
npm start
~~~

Abre [http://localhost:4200](http://localhost:4200) en el navegador. `npm start` inicia la app en el puerto 4200 y la API local en el puerto 3000. La terminal debe mostrar ambos procesos en ejecución.

### Ejecutar los procesos por separado

Si ya tienes Angular ejecutándose o necesitas revisar la API por separado, usa dos terminales dentro de la carpeta del proyecto:

Terminal 1:

~~~powershell
npm run start:app
~~~

Terminal 2:

~~~powershell
npm run server
~~~

La segunda terminal debe mostrar `PetCare API ready at http://localhost:3000`. No cierres esa terminal mientras pruebas la sincronización.

## Etapa 1: Detector de Estado de Red

Esta etapa permite conocer si el dispositivo tiene conexion a internet.

El servicio `ConnectivityService` usa `navigator.onLine` para conocer el estado inicial de la red y escucha los eventos del navegador:

- `online`: actualiza el estado cuando vuelve la conexion.
- `offline`: actualiza el estado cuando se pierde la conexion.

El estado se expone como una signal reactiva, `isOnline`, para que la interfaz y los servicios reaccionen inmediatamente al cambio.

Archivo principal:

- `src/app/services/connectivity.service.ts`

## Etapa 2: Modo Offline Funcional

Cuando no hay conexion, los cuidados registrados no se pierden. La aplicacion los guarda en el dispositivo y los envia automaticamente cuando la red vuelve.

### Flujo de guardado

1. El usuario registra el nombre de la mascota y el cuidado realizado.
2. La pantalla consulta el estado de `ConnectivityService`.
3. Si esta online, envia el registro mediante `POST` al endpoint configurado.
4. Si esta offline, o si el envio falla, guarda el registro en una cola local.
5. Al recuperar la conexion, la cola se sincroniza en el mismo orden en que fue creada.

### Persistencia local

La cola usa `localStorage` con la clave:

~~~text
petcare.pending-care-records
~~~

Cada registro conserva un identificador, el nombre de la mascota, la descripcion, la fecha de creacion y la fecha en que se agrego a la cola.

### Experiencia de usuario

La pantalla principal muestra:

- Un aviso visible cuando la aplicacion esta en modo offline.
- Un contador de registros pendientes de sincronizacion.
- Un mensaje al guardar un cuidado de forma sincronizada o local.
- Un formulario para registrar cuidados.

### Archivos principales

| Archivo | Responsabilidad |
| --- | --- |
| `src/app/services/connectivity.service.ts` | Detecta los cambios de conexion. |
| `src/app/services/care-record.service.ts` | Guarda, encola y sincroniza los cuidados. |
| `src/app/home/home.page.ts` | Gestiona el formulario y los mensajes al usuario. |
| `src/app/home/home.page.html` | Muestra el aviso offline, contador y formulario. |
| `src/app/home/home.page.scss` | Define los estilos del modo offline. |
| `src/environments/environment.ts` | Configura el endpoint en desarrollo. |
| `src/environments/environment.prod.ts` | Configura el endpoint en produccion. |

## Configuracion del servidor

En desarrollo, el endpoint es:

~~~ts
apiUrl: 'http://localhost:3000/api/care-records'
~~~

Produccion mantiene la ruta relativa `/api/care-records`, que debe ser atendida por el backend desplegado. Si el backend esta en otro dominio, actualiza `apiUrl` en produccion.

### Verificar la API local

Con `npm run server` en ejecución, puedes confirmar que la API responde:

~~~powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/health
~~~

La respuesta debe ser `200` con el contenido `{"status":"ok"}`. Los registros aceptados por la API local se guardan en `data/care-records.json`; ese archivo es solo para desarrollo y está ignorado por Git.

## Probar el modo offline y la sincronización

1. Inicia la app y confirma que la API local está encendida.
2. Abre DevTools con `F12` y entra en la pestaña **Network**.
3. En el desplegable que normalmente dice **No throttling**, selecciona **Offline**.
4. Registra un cuidado. Verás el aviso offline y aumentará el contador de pendientes.
5. En el mismo desplegable, vuelve a seleccionar **No throttling**.
6. La app intenta sincronizar inmediatamente. Si la API todavía no responde, conserva la cola y reintenta cada 15 segundos hasta recibir una respuesta correcta.
7. Cuando termine, el contador de pendientes desaparece. Puedes revisar la cola en **Application > Local Storage** con la clave `petcare.pending-care-records`.

### Solución de problemas

- **`net::ERR_CONNECTION_REFUSED` en `care-records`:** el navegador volvió a estar online, pero la API local no está ejecutándose. Abre otra terminal en el proyecto y ejecuta `npm run server`; espera el mensaje `PetCare API ready at http://localhost:3000`. La cola se reintentará automáticamente.
- **El contador sigue visible:** comprueba `http://localhost:3000/health`, verifica que DevTools esté en **No throttling** y espera hasta 15 segundos tras encender la API.
- **El puerto 4200 o 3000 ya está en uso:** cierra el proceso anterior que ocupa el puerto y vuelve a ejecutar `npm start`, o inicia los procesos por separado.

## Validacion

La aplicacion fue compilada con Angular en configuracion de desarrollo sin errores de compilacion.
