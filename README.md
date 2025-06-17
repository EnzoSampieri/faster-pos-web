# FASTER-POS-WEB: Sistema de Gestión de Mesas para Restaurantes

## Descripción General
Este proyecto es un sistema de punto de venta (POS) basado en web diseñado para la gestión de mesas en restaurantes. Permite a los garzones abrir y gestionar mesas, tomar pedidos, y emitir cuentas, con sincronización de datos a través de un servidor Node.js y un sistema de archivos remoto vía SCP. La interfaz de usuario está optimizada para pantallas táctiles en dispositivos móviles y tablets.

## Características Principales
*   **Gestión de Mesas:** Abre, reabre y cierra mesas con asignación de garzón y número de personas.
*   **Control de Acceso por Garzón:** Solo el garzón asignado puede reabrir su mesa; otros garzones son bloqueados.
*   **Toma de Pedidos Táctil:** Interfaz intuitiva para seleccionar productos por familia y subfamilia.
*   **Base de Datos de Productos Dinámica:** Los productos se cargan desde un archivo CSV remoto y pueden ser actualizados por el frontend.
*   **Registro de Comandas:** Generación de archivos TXT de comanda con `/header` y `/detalle` de los productos de la sesión actual, transferidos vía SCP al servidor.
*   **Emisión de Cuentas:** Generación de archivos TXT de cuenta con resumen de mesa y monto, transferidos vía SCP.
*   **Caché Local de Productos:** Pre-carga y caching de la base de datos de productos en el navegador para un rendimiento rápido.
*   **Cache Local de Pedidos:** Previene la pérdida de órdenes en caso de recarga de página.
*   **Diseño Responsivo:** Optimizado para una experiencia táctil en dispositivos móviles y tablets.

## Tecnologías Utilizadas
*   **Frontend:** HTML5, CSS3, JavaScript
*   **Backend:** Node.js, Express.js
*   **Base de Datos (simulada):** Archivos JSON (`mesas_abiertas.json`), Archivos CSV (`productos.csv`)
*   **Comunicación Remota:** SCP (Secure Copy Protocol) para transferencia de archivos.

## Requisitos Previos
Antes de empezar, asegúrate de tener instalado lo siguiente:
*   **Git:** Para clonar el repositorio. Puedes descargarlo de [git-scm.com](https://git-scm.com/downloads).
*   **Node.js y npm:** El entorno de ejecución de JavaScript y su gestor de paquetes. Descárgalo de [nodejs.org](https://nodejs.org/en/download/). Se recomienda la versión LTS.
*   **pscp.exe (PuTTY SCP):** Para la transferencia de archivos SCP en sistemas Windows. Asegúrate de que esté en tu `PATH` o accesible desde la terminal. (Si usas Linux/macOS, `scp` ya viene preinstalado).
*   **Servidor SSH en la máquina Linux:** Asegúrate de que el servidor Linux (`192.168.100.82` en este caso) tiene un servidor SSH funcionando y las credenciales configuradas correctamente para la transferencia SCP (usuario `user`, contraseña `4600`).

## Configuración del Entorno Local

### 1. Clonar el Repositorio
Abre tu terminal (PowerShell, Git Bash, o cualquier terminal de tu preferencia) y ejecuta:
```bash
git clone https://github.com/EnzoSampieri/faster-pos-web.git
cd faster-pos-web
```

### 2. Configuración del Backend
Navega a la carpeta `backend` e instala las dependencias de Node.js:
```bash
cd backend
npm install
```
Una vez instaladas, puedes iniciar el servidor:
```bash
node server.js
```
El servidor backend se ejecutará en `http://192.168.100.82:3000` (o la dirección configurada en `config.js`).

### 3. Configuración de la Base de Datos de Productos
La base de datos de productos (`productos.csv`) se transfiere desde el servidor Linux a la carpeta `db/` del backend.
*   Asegúrate de que el archivo `productos.csv` exista en `/home/user/mis-bases/` en tu servidor Linux.
*   El backend intentará descargar este archivo automáticamente cuando el frontend lo solicite (por ejemplo, al hacer clic en "Actualizar Productos" en `pedidos.html`).
*   Verifica que las credenciales SCP (`-pw 4600`) configuradas en `backend/server.js` sean correctas para la conexión a tu servidor Linux.

### 4. Acceso al Frontend
Una vez que el servidor backend esté en funcionamiento, puedes acceder a la aplicación frontend:
*   Abre el archivo `inicio.html` en tu navegador web.
*   **Importante:** Debido a las restricciones de seguridad del navegador para archivos locales (`file://` URLs) y solicitudes `fetch` (CORS), es ideal servir los archivos frontend a través de un servidor web local (ej. `http-server` de npm o configurar un servidor Nginx/Apache simple). Sin embargo, este proyecto está diseñado para ser accedido directamente por IP desde dispositivos en la misma red local.
*   Asegúrate de que `config.js` tenga la `BACKEND_BASE_URL` correcta (por ejemplo, `http://192.168.100.82:3000`).

## Uso de la Aplicación
1.  **Apertura de Mesa:** Desde `inicio.html`, selecciona una mesa, ingresa el código del garzón y el número de personas.
2.  **Toma de Pedidos:** Una vez en `pedidos.html`, selecciona familias y subfamilias para ver los productos. Haz clic en "Agregar" en las tarjetas de producto para añadir al pedido.
3.  **Enviar Pedido:** Haz clic en "Enviar Mesa" para guardar los nuevos productos al historial de la mesa y generar el archivo de comanda TXT en el servidor.
4.  **Cerrar Mesa:** En `mesas-abiertas.html`, las mesas abiertas se muestran con un botón "Cerrar Mesa" para eliminarlas del sistema.
5.  **Emitir Cuenta:** Próximamente se integrará una función para emitir la cuenta en formato TXT.
6.  **Actualizar Productos:** Utiliza el botón "Actualizar Productos" en `pedidos.html` para forzar la descarga de la última versión de `productos.csv` desde el servidor Linux.

## Notas Importantes / Troubleshooting
*   **Conexión SCP:** Si encuentras errores como "Access denied" o "Cannot GET /", verifica la conectividad de red, la dirección IP del servidor Linux, el puerto SSH (22 por defecto), las credenciales de usuario y la contraseña (`-pw 4600`).
*   **Firewall:** Asegúrate de que el firewall en la máquina donde corre el backend (`server.js`) permita las conexiones entrantes en el puerto 3000 (o el puerto configurado).
*   **Permisos de Carpetas:** El usuario de Linux utilizado para SCP debe tener permisos de escritura en la carpeta `/pedidos/` y `/db/` en el servidor Linux donde se guardan los archivos de comanda/cuenta y se descarga `productos.csv`.
*   **Desbordamiento de Texto en Botones:** En caso de que los textos en los botones de Familias/Subfamilias/Productos se desborden, se han aplicado reglas CSS con `text-overflow: ellipsis;` para truncar el texto. Asegúrate de que las `media queries` en `style.css` se apliquen correctamente para tu dispositivo.