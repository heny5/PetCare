# PetCare

Aplicacion Ionic/Angular para registrar cuidados de mascotas con soporte de conectividad y trabajo sin internet.

## Requisitos

- Node.js y npm.
- Dependencias instaladas con `npm install`.

## Ejecutar la aplicacion

~~~powershell
cd C:\Users\sting\Desktop\clone\PetCare
npx ng serve
~~~

Abre [http://localhost:4200](http://localhost:4200) en el navegador.

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

El endpoint actual es:

~~~ts
apiUrl: '/api/care-records'
~~~

Si el backend esta en otro dominio, actualiza `apiUrl` en ambos archivos de entorno.

## Probar el modo offline

1. Ejecuta la aplicacion.
2. Abre las herramientas del navegador con `F12`.
3. Ve a la pestana **Network**.
4. Activa **Offline**.
5. Registra un cuidado: aparecera el aviso offline y aumentara el contador de pendientes.
6. Desactiva **Offline**: la aplicacion intentara sincronizar la cola automaticamente.
7. En DevTools, ve a **Application > Local Storage** para consultar la clave `petcare.pending-care-records`.

## Validacion

La aplicacion fue compilada con Angular en configuracion de desarrollo sin errores de compilacion.
