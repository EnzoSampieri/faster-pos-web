# Sistema de Autenticación FASTER POS

## 🎯 Descripción

Se ha implementado un sistema completo de autenticación con control de acceso por dispositivo (MAC/IP) para el sistema FASTER POS. El sistema incluye:

- **Página de login** como punto de entrada único
- **Validación de usuarios** con archivo `garzones.json`
- **Control de dispositivos** con archivo `dispositivos.json`
- **Sesiones seguras** que expiran cada 24 horas
- **Protección de rutas** para todas las páginas y APIs

## 📁 Archivos Creados/Modificados

### Nuevos Archivos:
- `backend/garzones.json` - Usuarios y contraseñas del sistema
- `backend/dispositivos.json` - Control de dispositivos autorizados
- `frontend/views/login.html` - Página de inicio de sesión
- `backend/env-config-example.txt` - Ejemplo de configuración .env

### Archivos Modificados:
- `backend/server.js` - Sistema de autenticación y middleware
- `frontend/config.js` - Funciones de autenticación del frontend

## 🔧 Configuración

### 1. Configurar Variables de Entorno

Crea un archivo `.env` en el directorio `backend/` con el siguiente contenido:

```env
# Configuración de sesiones para el sistema de autenticación
SESSION_SECRET=tu_clave_secreta_muy_segura_aqui

# Variables existentes del sistema (mantener las que ya existan)
PSCP_PATH=c:/faster/pscp.exe
PSCP_REMOTE_HOST=192.168.100.10
PSCP_PORT_ORDERS=22
PSCP_PASSWORD=faster123
PSCP_ORDERS_PATH=/home/faster/orders/
PSCP_PRODUCTS_PATH=/home/faster/products/
PSCP_PORT_PRODUCTS=22
```

**⚠️ IMPORTANTE:** Cambia `SESSION_SECRET` por una clave segura y única.

### 2. Configurar Usuarios

Edita `backend/garzones.json` para agregar/modificar usuarios:

```json
{
  "admin": {
    "password": "admin123",
    "nombre": "Administrador",
    "rol": "admin"
  },
  "juan": {
    "password": "juan123",
    "nombre": "Juan Pérez",
    "rol": "garzon"
  }
}
```

### 3. Configurar Dispositivos

El archivo `backend/dispositivos.json` se crea automáticamente. Los dispositivos nuevos se registran con estado "pendiente" y deben ser aprobados manualmente cambiando el estado a "autorizado".

## 🚀 Funcionamiento

### Flujo de Autenticación:

1. **Acceso inicial**: Cualquier URL redirige a `login.html`
2. **Login**: Usuario ingresa credenciales
3. **Verificación de dispositivo**: 
   - Si es nuevo → Estado "pendiente" y bloquea acceso
   - Si está autorizado → Permite acceso
   - Si está bloqueado → Rechaza acceso
4. **Sesión**: Se crea una sesión válida por 24 horas
5. **Acceso al sistema**: Todas las páginas y APIs están protegidas

### Estados de Dispositivo:

- **pendiente**: Dispositivo nuevo, requiere aprobación
- **autorizado**: Dispositivo aprobado, acceso permitido
- **bloqueado**: Dispositivo bloqueado, acceso denegado

## 🔒 Seguridad

### Características Implementadas:

- **Sesiones seguras** con cookies httpOnly
- **Expiración automática** cada 24 horas
- **Control de dispositivos** por MAC/IP
- **Protección de rutas** con middleware de autenticación
- **Validación de credenciales** contra archivo JSON
- **Logs de autenticación** para auditoría

### Rutas Protegidas:

- Todas las páginas HTML (excepto login.html)
- APIs de mesas (`/mesas`, `/mesas/:id`)
- APIs de productos (`/productos`)
- APIs de modificadores (`/modificadores`)
- APIs de comandas (`/enviar-comanda-productos`)
- APIs de cierre de mesa (`/cerrar-mesa`)

## 📋 Gestión de Dispositivos

### Para Autorizar un Dispositivo:

1. Un usuario intenta acceder desde un dispositivo nuevo
2. El sistema registra el dispositivo en `dispositivos.json` con estado "pendiente"
3. El administrador edita manualmente el archivo `dispositivos.json`
4. Cambia el estado de "pendiente" a "autorizado"
5. El usuario puede acceder en el siguiente intento

### Estructura de dispositivos.json:

```json
{
  "AA:BB:CC:DD:EE:FF": {
    "ip": "192.168.100.50",
    "estado": "autorizado",
    "usuario": "juan",
    "fecha_registro": "2024-01-01T00:00:00.000Z",
    "ultimo_acceso": "2024-01-01T00:00:00.000Z"
  }
}
```

## 🛠️ Comandos de Instalación

```bash
# Instalar dependencias (si no están instaladas)
cd FASTER-POS-WEB/backend
npm install express-session

# Iniciar el servidor
npm start
```

## 🔍 Troubleshooting

### Problemas Comunes:

1. **Error de sesión**: Verificar que SESSION_SECRET esté configurado
2. **Dispositivo no autorizado**: Editar dispositivos.json manualmente
3. **Redirección infinita**: Verificar que login.html no esté protegida
4. **Cookies no funcionan**: Verificar configuración de CORS y cookies

### Logs de Debug:

El sistema genera logs detallados en la consola del servidor para:
- Intentos de login
- Verificación de dispositivos
- Creación de sesiones
- Errores de autenticación

## 📝 Notas Importantes

- **No se modificó** la funcionalidad existente del sistema
- **No se cambiaron** los estilos ni la lógica de negocio
- **Solo se agregó** la capa de seguridad
- **Las sesiones** expiran automáticamente cada 24 horas
- **Los dispositivos** deben ser aprobados manualmente la primera vez

## 🔄 Migración

Para sistemas existentes:

1. Hacer backup de la configuración actual
2. Copiar los nuevos archivos
3. Configurar el archivo .env
4. Configurar usuarios en garzones.json
5. Probar el acceso desde cada dispositivo
6. Autorizar dispositivos según sea necesario

---

**Sistema implementado exitosamente sin afectar la funcionalidad existente.** 