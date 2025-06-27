const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const session = require('express-session');
const { exec } = require('child_process');
const puppeteer = require('puppeteer');
const arp = require('node-arp');
const util = require('util');
const MercadoPagoOAuth = require('./mercadopago-oauth');
const app = express();
const PORT = 3000;
const MESAS_DIR = path.join(__dirname, 'mesas_abiertas');

// Initialize MercadoPago OAuth
const mercadopagoOAuth = new MercadoPagoOAuth();

// Asegurar que el directorio de mesas existe
if (!fs.existsSync(MESAS_DIR)) {
  fs.mkdirSync(MESAS_DIR, { recursive: true });
  console.log(`Directorio de mesas creado: ${MESAS_DIR}`);
}

console.log('----------------------------------------------------------');
console.log('🚀 Servidor Faster POS iniciando...');
console.log(`Directorio de trabajo actual (process.cwd()): ${process.cwd()}`);
console.log(`Directorio del archivo server.js (__dirname): ${__dirname}`);

// Configuración del sistema de logging
const logsDir = path.join(__dirname, 'logs');
console.log(`Directorio de logs configurado como: ${logsDir}`);

if (!fs.existsSync(logsDir)) {
  console.log(`Creando directorio de logs: ${logsDir}`);
  fs.mkdirSync(logsDir, { recursive: true });
} else {
  console.log(`Directorio de logs ya existe: ${logsDir}`);
}

function getLogFilePath() {
  const today = new Date().toISOString().split('T')[0];
  const logFilePath = path.join(logsDir, `${today}.log`);
  console.log(`[Log Debug] Ruta del archivo de log del día: ${logFilePath}`);
  return logFilePath;
}

function logTransfer(status, type, filePath, destination, message = '') {
  const timestamp = new Date().toISOString();
  const logLine = `${timestamp} | ${status} | ${type} | ${filePath} → ${destination} | ${message}\n`;
  try {
    fs.appendFileSync(getLogFilePath(), logLine, 'utf8');
    console.log(`[Log Transferencia Escrito] ${logLine.trim()}`);
  } catch (err) {
    console.error(`❌ Error al escribir log de transferencia: ${err.message}`);
  }
}

// Función de logging para acciones de administración
function logAdminAction(status, actionType, entityId, message, user) {
  const timestamp = new Date().toISOString();
  const logLine = `${timestamp} | ${status} | ADMIN_ACTION | ${actionType} | ${entityId} | User: ${user} | Message: ${message}\n`;
  try {
    fs.appendFileSync(getLogFilePath(), logLine, 'utf8');
    console.log(`[Log Admin Escrito] ${logLine.trim()}`);
  } catch (err) {
    console.error(`❌ Error al escribir log de admin: ${err.message}`);
  }
}

// Verificación de variables de entorno críticas
const requiredEnvVars = [
  'PSCP_PATH',
  'PSCP_REMOTE_HOST',
  'PSCP_PORT_ORDERS',
  'PSCP_PASSWORD',
  'PSCP_ORDERS_PATH'
];

// Verificar que todas las variables requeridas estén definidas
console.log('📋 Verificando variables de entorno:');
requiredEnvVars.forEach(varName => {
  if (!process.env[varName]) {
    console.error(`❌ Variable de entorno requerida no definida: ${varName}`);
  } else {
    console.log(`✅ ${varName}: ${varName.includes('PASSWORD') ? '******' : process.env[varName]}`);
  }
});

// Configuración de PSCP
const PSCP_PATH = process.env.PSCP_PATH;
const REMOTE_HOST = process.env.PSCP_REMOTE_HOST;
const REMOTE_PATH = process.env.PSCP_ORDERS_PATH;
const PSCP_PORT = process.env.PSCP_PORT_ORDERS;
const PSCP_PASSWORD = process.env.PSCP_PASSWORD;

// Variables para el caché de productos
let cachedProducts = null;
let lastModifiedTime = 0; // Marca de tiempo de la última modificación de productos.csv

app.use(cors());
app.use(express.json());

// Configuración de sesiones
app.use(session({
  secret: process.env.SESSION_SECRET || 'faster_pos_secret_key_2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Cambiar a true en producción con HTTPS
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

// Servir archivos estáticos desde /frontend y /frontend/views
app.use(express.static(path.join(__dirname, '..', 'frontend')));
app.use(express.static(path.join(__dirname, '..', 'frontend', 'views')));

// Servir archivos CSS con el tipo MIME correcto
app.use('/frontend/css', express.static(path.join(__dirname, '..', 'frontend', 'css'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));

// Redirigir la raíz a login.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'views', 'login.html'));
});

// ===== RUTAS PROTEGIDAS PARA ARCHIVOS HTML =====

// Ruta para inicio.html (protegida)
app.get('/inicio.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'views', 'inicio.html'));
});

// Ruta para apertura-mesa.html (protegida)
app.get('/apertura-mesa.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'views', 'apertura-mesa.html'));
});

// Ruta para pedidos.html (protegida)
app.get('/pedidos.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'views', 'pedidos.html'));
});

// Ruta para estado-mesa.html (protegida)
app.get('/estado-mesa.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'views', 'estado-mesa.html'));
});

// Ruta para gerencia.html (protegida)
app.get('/gerencia.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'views', 'gerencia.html'));
});

// Ruta para cierre-mesa.html (protegida)
app.get('/cierre-mesa.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'views', 'cierre-mesa.html'));
});

// Ruta para cuentas.html (protegida)
app.get('/cuentas.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'views', 'cuentas.html'));
});

// Ruta para configuracion.html (protegida)
app.get('/configuracion.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'views', 'configuracion.html'));
});

// Ruta para reportes.html (protegida)
app.get('/reportes.html', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'views', 'reportes.html'));
});

// Leer todas las mesas abiertas
app.get('/mesas', isAuthenticated, (req, res) => {
  console.log('[GET /mesas Debug] Solicitud recibida para cargar todas las mesas.');
  try {
    const mesas = {};
    const archivos = fs.readdirSync(MESAS_DIR);
    
    archivos.forEach(archivo => {
      if (archivo.startsWith('mesa-') && archivo.endsWith('.json')) {
        const mesaId = archivo.replace('mesa-', '').replace('.json', '');
        const contenido = fs.readFileSync(path.join(MESAS_DIR, archivo), 'utf8');
        mesas[mesaId] = JSON.parse(contenido);
      }
    });
    
    console.log(`[GET /mesas Debug] Mesas cargadas:`, Object.keys(mesas));
    res.json(mesas);
  } catch (error) {
    console.error(`❌ [GET /mesas Debug] Error al leer mesas:`, error);
    res.status(500).json({ error: 'Error al cargar mesas.', details: error.message });
  }
});

// Leer una mesa específica
app.get('/mesas/:mesaId', isAuthenticated, (req, res) => {
  const mesaId = req.params.mesaId;
  const mesaPath = path.join(MESAS_DIR, `mesa-${mesaId}.json`);
  console.log(`[GET /mesas/:mesaId Debug] Solicitud recibida para mesa: ${mesaId}`);
  
  try {
    if (!fs.existsSync(mesaPath)) {
      console.log(`[GET /mesas/:mesaId Debug] Mesa ${mesaId} no encontrada.`);
      return res.status(404).json({ error: 'Mesa no encontrada.' });
    }
    
    const contenido = fs.readFileSync(mesaPath, 'utf8');
    const mesa = JSON.parse(contenido);
    console.log(`[GET /mesas/:mesaId Debug] Mesa ${mesaId} encontrada.`);
    res.json(mesa);
  } catch (error) {
    console.error(`❌ [GET /mesas/:mesaId Debug] Error al leer mesa ${mesaId}:`, error);
    res.status(500).json({ error: 'Error al cargar mesa específica.', details: error.message });
  }
});

// Guardar/actualizar una mesa abierta
app.post('/mesas', isAuthenticated, (req, res) => {
  const incomingMesa = req.body;
  console.log('[POST /mesas Debug] Solicitud recibida para guardar/actualizar mesa:', incomingMesa.mesa);

  if (!incomingMesa.mesa || !incomingMesa.garzon || !incomingMesa["id-garzon"]) {
    return res.status(400).json({ error: 'Faltan datos (mesa, garzón o id-garzon).' });
  }

  // Validar que el garzon y el id-garzon correspondan en garzones.json
  let idGarzonValido = false;
  const garzonesPath = path.join(__dirname, 'garzones.json');
  if (fs.existsSync(garzonesPath)) {
    const garzonesData = fs.readFileSync(garzonesPath, 'utf8');
    const garzones = JSON.parse(garzonesData);
    for (const [nombre, datos] of Object.entries(garzones)) {
      if (nombre === incomingMesa.garzon && datos["id-garzon"] === incomingMesa["id-garzon"]) {
        idGarzonValido = true;
        break;
      }
    }
  }
  if (!idGarzonValido) {
    const warnMsg = `[POST /mesas] id-garzon o nombre de garzón ausente o inválido para mesa ${incomingMesa.mesa} (recibido: garzon=${incomingMesa.garzon}, id-garzon=${incomingMesa["id-garzon"]})`;
    console.warn(warnMsg);
    logAdminAction('WARN', 'Abrir Mesa', `Mesa ${incomingMesa.mesa}`, warnMsg, 'Backend');
    return res.status(400).json({ error: 'No se puede abrir la mesa: id-garzon o nombre de garzón ausente o inválido.' });
  }

  const mesaId = incomingMesa.mesa;
  const mesaPath = path.join(MESAS_DIR, `mesa-${mesaId}.json`);

  try {
    let mesaToSave = {
      mesa: incomingMesa.mesa,
      garzon: incomingMesa.garzon, // nombre
      "id-garzon": incomingMesa["id-garzon"],
      productos: incomingMesa.productos || [],
      personas: incomingMesa.personas,
      horaApertura: incomingMesa.horaApertura
    };

    if (fs.existsSync(mesaPath)) {
      const contenido = fs.readFileSync(mesaPath, 'utf8');
      const existingMesa = JSON.parse(contenido);

      // 🔒 Si otro garzón la abrió antes, bloquear
      if (existingMesa.garzon !== incomingMesa.garzon) {
        return res.status(403).json({
          error: `Mesa ${mesaId} ya está siendo atendida por el garzón ${existingMesa.garzon}.`
        });
      }

      // Mismo garzón: acumular productos
      const updatedProductos = [...existingMesa.productos];
      (incomingMesa.productos || []).forEach(newProd => {
        const existingProdIndex = updatedProductos.findIndex(p => p.codigo === newProd.codigo);
        if (existingProdIndex > -1) {
          updatedProductos[existingProdIndex].cantidad = parseInt(updatedProductos[existingProdIndex].cantidad) + parseInt(newProd.cantidad);
        } else {
          updatedProductos.push(newProd);
        }
      });

      mesaToSave.productos = updatedProductos;
      mesaToSave.personas = incomingMesa.personas || existingMesa.personas;
      mesaToSave.horaApertura = existingMesa.horaApertura;
    }

    fs.writeFileSync(mesaPath, JSON.stringify(mesaToSave, null, 2));
    console.log(`[POST /mesas Debug] Mesa ${mesaId} guardada/actualizada en ${mesaPath}.`);
    res.json({ ok: true, message: 'Mesa guardada correctamente.' });
  } catch (error) {
    console.error(`❌ [POST /mesas Debug] Error al escribir mesa ${mesaId}:`, error);
    res.status(500).json({ error: 'Error interno del servidor al guardar la mesa.', details: error.message });
  }
});


// Endpoint para eliminar una mesa
app.delete('/mesas/:mesaId', isAuthenticated, async (req, res) => {
  const mesaId = req.params.mesaId;
  const mesaPath = path.join(MESAS_DIR, `mesa-${mesaId}.json`);
  console.log(`[DELETE /mesas/:mesaId Debug] Solicitud para eliminar mesa: ${mesaId}`);

  try {
    if (!fs.existsSync(mesaPath)) {
      console.log(`🤔 Mesa ${mesaId} no encontrada en ${mesaPath}. No se necesita eliminar.`);
      logAdminAction('INFO', 'Eliminar Mesa', `Mesa ${mesaId}`, `Mesa no encontrada en ${mesaPath}.`, 'Admin');
      return res.status(404).json({ error: `Mesa ${mesaId} no encontrada.` });
    }

    // Leer la mesa antes de eliminarla para el log
    const mesaAEliminar = JSON.parse(fs.readFileSync(mesaPath, 'utf8'));
    
    // Eliminar el archivo
    fs.unlinkSync(mesaPath);
    console.log(`✅ Mesa ${mesaId} eliminada exitosamente de ${mesaPath}.`);
    logAdminAction('SUCCESS', 'Eliminar Mesa', `Mesa ${mesaId}`, `Mesa eliminada de ${mesaPath}.`, 'Admin');
    res.status(200).json({ success: true, message: `Mesa ${mesaId} eliminada.` });
  } catch (error) {
    console.error(`❌ [DELETE /mesas/:mesaId Debug] Error al eliminar mesa ${mesaId}:`, error);
    logAdminAction('ERROR', 'Eliminar Mesa', `Mesa ${mesaId}`, `Error al eliminar mesa: ${error.message}`, 'Admin');
    res.status(500).json({ error: 'Error interno del servidor al eliminar la mesa.', details: error.message });
  }
});

// Endpoint para verificar la contraseña de un garzón (sin afectar la sesión)
app.post('/verify-garzon', (req, res) => {
  const claveIngresada = req.body.password;
  console.log(`[VERIFY-GARZON] Intento de verificación recibido. Clave ingresada: '${claveIngresada}'`);

  if (!claveIngresada) {
    return res.status(400).json({ success: false, message: 'Falta la clave del garzón.' });
  }

  try {
    const garzonesPath = path.join(__dirname, 'garzones.json');
    if (!fs.existsSync(garzonesPath)) {
      console.error('[VERIFY-GARZON] ERROR: El archivo garzones.json no se encuentra.');
      return res.status(500).json({ success: false, message: 'Archivo de garzones no encontrado.' });
    }

    const garzonesData = fs.readFileSync(garzonesPath, 'utf8');
    const garzones = JSON.parse(garzonesData);

    let garzonEncontrado = null;
    let nombreGarzon = null;
    let idGarzon = null;
    for (const [nombre, datos] of Object.entries(garzones)) {
      if (datos.password === claveIngresada) {
        garzonEncontrado = datos;
        nombreGarzon = nombre;
        idGarzon = datos["id-garzon"];
        break;
      }
    }

    if (garzonEncontrado) {
      console.log(`[VERIFY-GARZON] ÉXITO: Garzón '${nombreGarzon}' autorizado para abrir mesa. id-garzon: ${idGarzon}`);
      res.json({ success: true, message: 'Garzón verificado correctamente.', nombre: nombreGarzon, id_garzon: idGarzon });
    } else {
      console.log(`[VERIFY-GARZON] FALLO: Clave de garzón no autorizada.`);
      res.status(401).json({ success: false, message: 'Garzón no autorizado.' });
    }
  } catch (error) {
    console.error('[VERIFY-GARZON] ERROR INTERNO:', error);
    res.status(500).json({ success: false, message: 'Error interno al verificar la clave del garzón.' });
  }
});

// ===== RUTAS DE AUTENTICACIÓN =====

// Endpoint para login principal
app.post('/login', async (req, res) => {
  const { codigo, password } = req.body;
  const clientIp = getClientIp(req);
  let clientMac;

  try {
    clientMac = await getClientMac(clientIp);
    if (!clientMac) {
      console.warn(`[WARN] No se pudo obtener la MAC para la IP: ${clientIp}. Usando IP como identificador.`);
      clientMac = clientIp; // Usar IP como fallback si la MAC no está disponible
    }
  } catch (e) {
      console.error(`[ERROR] Fallo crítico al obtener MAC. Usando IP.`, e);
      clientMac = clientIp;
  }
  
  const clientIdentifier = clientMac;

  try {
    const dispositivos = loadDispositivos();
    const device = dispositivos[clientIdentifier];
    const deviceStatus = device?.estado || 'pendiente';

    // 1. Manejar Dispositivos Bloqueados
    if (deviceStatus === 'bloqueado') {
      logAdminAction('FAIL', 'Login', codigo, 'Intento desde dispositivo bloqueado.', clientIdentifier);
      return res.status(403).json({ success: false, status: 'device_blocked', message: 'Dispositivo bloqueado.' });
    }

    // 2. Manejar Dispositivos Pendientes
    if (deviceStatus === 'pendiente') {
      logAdminAction('PENDING', 'Login', codigo, 'Intento desde dispositivo pendiente.', clientIdentifier);
      if (!device) { // Registrar solo si es un dispositivo completamente nuevo
        dispositivos[clientIdentifier] = {
          estado: 'pendiente',
          ip: clientIp,
          fecha_registro: new Date().toISOString(),
          ultimo_intento_usuario: codigo,
        };
        saveDispositivos(dispositivos);
        logAdminAction('INFO', 'Device', 'System', `Nuevo dispositivo pendiente registrado: ${clientIdentifier}`, clientIdentifier);
      }
      return res.status(401).json({ success: false, status: 'device_pending', message: 'Dispositivo pendiente de autorización.' });
    }
    
    // 3. Manejar Dispositivos Autorizados
    const terminales = loadJSON('terminales.json');
    let user = null;

    // Buscar terminal por nombre de usuario y clave
    if (Array.isArray(terminales)) {
      // terminales.json es un array
      const encontrado = terminales.find(u => u.usuario === codigo && u.clave === password);
      if (encontrado) {
        user = { codigo: encontrado.usuario, rol: 'terminal', ...encontrado };
      }
    } else if (terminales[codigo] && terminales[codigo].clave === password) {
      // terminales.json es un objeto (soporte alternativo)
      user = { codigo, rol: 'terminal', ...terminales[codigo] };
    }

    // Si no se encontró en terminales, buscar en administradores.json
    if (!user) {
      const administradores = loadJSON('administradores.json');
      if (administradores[codigo] && administradores[codigo].password === password) {
        user = { codigo, rol: 'admin', ...administradores[codigo] };
      }
    }

    if (user) {
      // Credenciales correctas: actualizar dispositivo y crear sesión
      req.session.usuario = { codigo: user.codigo, rol: user.rol };
      device.ultimo_acceso = new Date().toISOString();
      device.ultimo_usuario = user.codigo;
      saveDispositivos(dispositivos);
      logAdminAction('SUCCESS', 'Login', user.codigo, `Login exitoso como ${user.rol}.`, clientIdentifier);
      return res.json({
        status: 'success',
        success: true,
        message: 'Inicio de sesión exitoso.',
        rol: user.rol,
        userCode: user.codigo
      });
    } else {
      // Credenciales incorrectas
      logAdminAction('FAIL', 'Login', codigo, 'Credenciales incorrectas.', clientIdentifier);
      return res.status(401).json({ success: false, message: 'Usuario o contraseña incorrectos.' });
    }

  } catch (error) {
    logAdminAction('ERROR', 'Login', codigo, `Error interno del servidor: ${error.message}`, clientIdentifier);
    console.error('[CRITICAL LOGIN ERROR]', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor al autenticar.' });
  }
});

// Endpoint para logout
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('[Logout Debug] Error al destruir sesión:', err);
      return res.status(500).json({ 
        status: 'error', 
        message: 'Error al cerrar sesión.' 
      });
    }
    res.json({ 
      status: 'success', 
      message: 'Sesión cerrada correctamente.' 
    });
  });
});

// Endpoint para verificar estado de autenticación
app.get('/auth/status', (req, res) => {
  if (req.session && req.session.usuario) {
    res.json({ 
      authenticated: true, 
      usuario: req.session.usuario 
    });
  } else {
    res.json({ authenticated: false });
  }
});

// Endpoint para obtener información del dispositivo
app.get('/device/info', (req, res) => {
  const dispositivo = checkDispositivo(req);
  const mac = getClientMAC(req);
  const ip = getClientIP(req);
  
  res.json({
    mac: mac,
    ip: ip,
    estado: dispositivo.estado,
    usuario: dispositivo.usuario,
    fecha_registro: dispositivo.fecha_registro,
    ultimo_acceso: dispositivo.ultimo_acceso
  });
});

// Endpoint para enviar comanda de productos
app.post('/enviar-comanda-productos', isAuthenticated, async (req, res) => {
  try {
    console.log('📥 Recibida solicitud de envío de comanda');
    console.log('Datos recibidos:', JSON.stringify(req.body, null, 2));

    // Verificar PSCP
    if (!verificarPSCP()) {
      throw new Error('Configuración de PSCP incorrecta');
    }

    const { mesa, garzon, productos, horaApertura, timestampedFileName, fileContent } = req.body;
    const idGarzon = req.body['id-garzon'];

    // Validación detallada de datos requeridos
    const datosFaltantes = [];
    if (!mesa) datosFaltantes.push('mesa');
    if (!garzon) datosFaltantes.push('garzon');
    if (!idGarzon) datosFaltantes.push('id-garzon');
    if (!productos || !Array.isArray(productos) || productos.length === 0) datosFaltantes.push('productos');
    if (!timestampedFileName) datosFaltantes.push('timestampedFileName');

    if (datosFaltantes.length > 0) {
      console.error('❌ Datos faltantes en la solicitud:', datosFaltantes);
      throw new Error(`Faltan datos requeridos en la solicitud: ${datosFaltantes.join(', ')}`);
    }

    // Crear directorio temporal si no existe
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir);
    }

    // Construir el contenido del archivo TXT usando id-garzon en el header
    let formattedHoraApertura = '000000';
    if (horaApertura) {
      const parts = String(horaApertura).split(':');
      const h = parts[0] ? String(parts[0]).padStart(2, '0') : '00';
      const m = parts[1] ? String(parts[1]).padStart(2, '0') : '00';
      const s = parts[2] ? String(parts[2]).padStart(2, '0') : '00';
      formattedHoraApertura = `${h}${m}${s}`;
    }
    const mesaFormatted = String(mesa).padStart(2, '0');
    const idGarzonFormatted = String(idGarzon).padStart(2, '0');
    const personasFormatted = String(req.body.personas || '').padStart(2, '0');
    let headerContent = `/header\n${mesaFormatted}\n${idGarzonFormatted}\n${personasFormatted}\n${formattedHoraApertura}\n/detalle\n`;
    let detalleContent = '';
    if (fileContent && fileContent.includes('/detalle\n')) {
      // Extraer solo la parte de detalle del fileContent recibido
      const detalleIndex = fileContent.indexOf('/detalle\n');
      detalleContent = fileContent.substring(detalleIndex + '/detalle\n'.length);
    }
    const finalTxtContent = headerContent + detalleContent;

    // Generar archivo TXT
    const timestampedOutputPath = path.join(tempDir, timestampedFileName);
    fs.writeFileSync(timestampedOutputPath, finalTxtContent);
    console.log(`📝 Archivo generado: ${timestampedOutputPath}`);
    console.log(`📄 Contenido del archivo:\n${finalTxtContent}`);

    // Transferir archivo
    await transferirArchivo(timestampedOutputPath, timestampedFileName);
    console.log(`✅ Archivo transferido: ${timestampedFileName}`);

    // Limpiar archivo temporal después de un breve delay
    setTimeout(() => {
      try {
        if (fs.existsSync(timestampedOutputPath)) {
          fs.unlinkSync(timestampedOutputPath);
          console.log(`🧹 Archivo temporal eliminado: ${timestampedOutputPath}`);
        }
      } catch (error) {
        console.error(`❌ Error al eliminar archivo temporal: ${error.message}`);
      }
    }, 5000);

    res.json({ 
      success: true, 
      message: `Comanda enviada exitosamente: ${timestampedFileName}`,
      details: {
        localPath: timestampedOutputPath,
        remotePath: `${REMOTE_PATH}${timestampedFileName}`,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error en /enviar-comanda-productos:', error);
    res.status(500).json({ 
      error: error.message,
      details: {
        timestamp: new Date().toISOString(),
        stack: error.stack
      }
    });
  }
});

const formatTimeAsHHMMSS = (date) => {
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${hours}${minutes}${seconds}`;
};

// Endpoint para emitir cuenta HTML y devolver URL pública
app.post('/emitir-cuenta', async (req, res) => {
  try {
    // Obtener número de mesa desde query o body
    const mesaId = req.query.mesa || req.body.mesa;
    if (!mesaId) {
      return res.status(400).json({ error: 'Falta el número de mesa.' });
    }
    const mesaPath = path.join(__dirname, 'mesas_abiertas', `mesa-${mesaId}.json`);
    if (!fs.existsSync(mesaPath)) {
      return res.status(404).json({ error: `No existe la mesa ${mesaId}` });
    }
    // Cargar datos de la mesa
    const mesaData = JSON.parse(fs.readFileSync(mesaPath, 'utf8'));
    // Cargar plantilla HTML
    const plantillaPath = path.join(__dirname, '..', 'frontend', 'templates', 'plantilla_cuenta.html');
    if (!fs.existsSync(plantillaPath)) {
      return res.status(500).json({ error: 'No se encuentra la plantilla de cuenta.' });
    }
    let plantilla = fs.readFileSync(plantillaPath, 'utf8');
    // Reemplazar placeholders en la plantilla
    const now = new Date();
    const hora = mesaData.horaApertura || now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
    const nombreRestaurante = process.env.NOMBRE_RESTAURANTE || 'Mi Restaurante';
    // Detalle productos
    let detalleProductosHtml = '';
    let totalConsumido = 0;
    if (Array.isArray(mesaData.productos) && mesaData.productos.length > 0) {
      detalleProductosHtml = mesaData.productos.map(p =>
        `<tr><td>${p.nombre}</td><td>${p.cantidad}</td><td>$${p.precio}</td></tr>`
      ).join('\n');
      totalConsumido = mesaData.productos.reduce((sum, p) => sum + (parseFloat(p.precio) * (p.cantidad || 1)), 0);
    } else {
      detalleProductosHtml = '<tr><td colspan="3">Sin productos</td></tr>';
    }
    // Descuento y propina
    const descuento = mesaData.descuento ? parseFloat(mesaData.descuento) : 0;
    const propina = Math.round((totalConsumido - descuento) * 0.10);
    const totalFinal = totalConsumido - descuento + propina;
    // Reemplazos
    plantilla = plantilla.replace(/{{\s*nombre_restaurante\s*}}/gi, nombreRestaurante);
    plantilla = plantilla.replace(/{{\s*hora\s*}}/gi, hora);
    plantilla = plantilla.replace(/{{\s*garzon\s*}}/gi, mesaData.garzon || '');
    plantilla = plantilla.replace(/{{\s*detalle_productos\s*}}/gi, detalleProductosHtml);
    plantilla = plantilla.replace(/{{\s*total_consumido\s*}}/gi, `$${totalConsumido.toFixed(0)}`);
    plantilla = plantilla.replace(/{{\s*descuento\s*}}/gi, `$${descuento.toFixed(0)}`);
    plantilla = plantilla.replace(/{{\s*propina\s*}}/gi, `$${propina}`);
    plantilla = plantilla.replace(/{{\s*total_final\s*}}/gi, `$${totalFinal}`);
    // Crear carpeta cuentas si no existe
    const cuentasDir = path.join(__dirname, '..', 'frontend', 'cuentas');
    if (!fs.existsSync(cuentasDir)) {
      fs.mkdirSync(cuentasDir, { recursive: true });
    }
    // Guardar archivo HTML
    const cuentaHtmlPath = path.join(cuentasDir, `mesa-${mesaId}.html`);
    fs.writeFileSync(cuentaHtmlPath, plantilla, 'utf8');
    // Construir URL pública (ajustar dominio según despliegue real)
    const publicUrl = `${process.env.PUBLIC_BASE_URL || 'http://localhost:3000'}/cuentas/mesa-${mesaId}.html`;
    res.json({ success: true, url: publicUrl });
  } catch (error) {
    console.error('❌ [POST /emitir-cuenta] Error:', error);
    res.status(500).json({ error: 'Error al emitir cuenta', details: error.message });
  }
});

// Endpoint para recibir confirmación de pago desde el backend antiguo
app.post('/estado-mesa', express.urlencoded({ extended: true }), (req, res) => {
  const timestamp = new Date().toISOString();
  
  // 🔍 LOG DETALLADO DEL CURL ENTRANTE
  console.log(`\n🔍 [CURL ENTRANTE - ${timestamp}] ==========================================`);
  console.log(`📥 URL completa: ${req.url}`);
  console.log(`📥 Método: ${req.method}`);
  console.log(`📥 Body raw:`, req.body);
  console.log(`📥 Body como string:`, JSON.stringify(req.body));
  console.log(`📥 User-Agent:`, req.headers['user-agent']);
  console.log(`📥 IP origen:`, req.ip || req.connection.remoteAddress);
  console.log(`🔍 [FIN CURL ENTRANTE] ==========================================\n`);
  
  // Log detallado en archivo
  const curlLogEntry = `\n[${timestamp}] CURL ENTRANTE /estado-mesa:
URL: ${req.url}
Método: ${req.method}
Body: ${JSON.stringify(req.body)}
User-Agent: ${req.headers['user-agent']}
IP: ${req.ip || req.connection.remoteAddress}
----------------------------------------\n`;
  
  try {
    fs.appendFileSync(getLogFilePath(), curlLogEntry, 'utf8');
  } catch (err) {
    console.error(`❌ Error al escribir log de curl: ${err.message}`);
  }
  
  // Intentar obtener mesa y estado de diferentes formas
  let mesa = req.body.mesa;
  let estado = req.body.estado;

  // Si no se encuentra en el body, intentar parsear la URL
  if (!mesa || !estado) {
    console.log(`🔍 [DEBUG] Mesa o estado no encontrado en body. Mesa: "${mesa}", Estado: "${estado}"`);
    console.log(`🔍 [DEBUG] Intentando extraer de URL...`);
    
    // Intentar extraer parámetros de la URL incluso si vienen en formato incorrecto
    const urlParts = req.url.split('?');
    if (urlParts.length > 1) {
      const queryString = urlParts[1].replace(/\\/g, '').trim(); // Eliminar barras invertidas y espacios
      console.log(`🔍 [DEBUG] Query string extraída: "${queryString}"`);
      
      const params = new URLSearchParams(queryString);
      mesa = mesa || params.get('mesa');
      estado = estado || params.get('estado');
      console.log(`🔍 [DEBUG] Después de parsear URL - Mesa: "${mesa}", Estado: "${estado}"`);
    }
  }

  // Si aún no tenemos los datos, intentar extraerlos del body como string
  if (!mesa || !estado) {
    console.log(`🔍 [DEBUG] Aún faltan datos. Intentando extraer del body como string...`);
    const bodyStr = JSON.stringify(req.body);
    const mesaMatch = bodyStr.match(/mesa=(\d+)/);
    const estadoMatch = bodyStr.match(/estado=(\w+)/);
    if (mesaMatch) mesa = mesaMatch[1];
    if (estadoMatch) estado = estadoMatch[1];
    console.log(`🔍 [DEBUG] Después de regex - Mesa: "${mesa}", Estado: "${estado}"`);
  }

  console.log(`[↩️] Estado recibido para mesa ${mesa}: ${estado}`);
  logAdminAction('INFO', 'Estado Mesa', `Mesa ${mesa}`, `Estado recibido: ${estado}`, 'Backend Antiguo');

  if (!mesa || !estado) {
    console.error(`[❌] Error: Faltan datos en la solicitud. Mesa: ${mesa}, Estado: ${estado}`);
    console.error(`[❌] URL completa: ${req.url}`);
    console.error(`[❌] Body completo:`, req.body);
    logAdminAction('ERROR', 'Estado Mesa', `Mesa ${mesa}`, 'Faltan datos en la solicitud', 'Backend Antiguo');
    return res.status(400).send('Faltan datos');
  }

  // Normalizar el estado a minúsculas para comparar
  const estadoNormalizado = (estado || '').toLowerCase();
  console.log(`🔍 [DEBUG] Estado original: "${estado}", Normalizado: "${estadoNormalizado}"`);
  
  // 🔄 NUEVA LÓGICA: Solo registrar el estado, NO eliminar la mesa automáticamente
  // El frontend debe consultar este estado y decidir si cerrar o no
  
  // Guardar el estado en un archivo temporal para que el frontend lo consulte
  const estadoMesaPath = path.join(__dirname, 'temp', `estado-mesa-${mesa}.json`);
  
  try {
    // Crear directorio temp si no existe
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    // Guardar el estado recibido del Linux
    const estadoData = {
      mesa: mesa,
      estado: estadoNormalizado,
      timestamp: timestamp,
      ipOrigen: req.ip || req.connection.remoteAddress,
      userAgent: req.headers['user-agent']
    };
    
    fs.writeFileSync(estadoMesaPath, JSON.stringify(estadoData, null, 2));
    console.log(`✅ [DEBUG] Estado de mesa ${mesa} guardado: ${estadoNormalizado}`);
    
    // Log según el estado recibido
    if (["pagada", "pagado", "cerrada", "cerrado"].includes(estadoNormalizado)) {
      console.log(`✅ [DEBUG] Linux confirma pago/cierre para mesa ${mesa}: "${estadoNormalizado}"`);
      logAdminAction('INFO', 'Estado Mesa', `Mesa ${mesa}`, `Linux confirma pago: ${estado}`, 'Backend Antiguo');
    } else {
      console.log(`🕓 [DEBUG] Linux indica mesa ${mesa} aún abierta: "${estadoNormalizado}"`);
      logAdminAction('INFO', 'Estado Mesa', `Mesa ${mesa}`, `Linux indica abierta: ${estado}`, 'Backend Antiguo');
    }
    
  } catch (error) {
    console.error(`❌ [DEBUG] Error al guardar estado de mesa ${mesa}:`, error);
    logAdminAction('ERROR', 'Estado Mesa', `Mesa ${mesa}`, `Error al guardar estado: ${error.message}`, 'Backend Antiguo');
  }

  res.status(200).send('Estado procesado');
});

// Nueva ruta para obtener la base de productos desde el backend con caché
app.get('/productos', isAuthenticated, (req, res) => {
  const localProductsPath = path.join(__dirname, '..', 'db', 'productos.csv'); // La ruta local del backend a productos.csv

  // Verificar la fecha de modificación del archivo
  fs.stat(localProductsPath, (err, stats) => {
    if (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Base de productos no encontrada. Ejecute /descargar-productos primero.' });
      }
      console.error('Error al obtener estadísticas de productos.csv:', err);
      return res.status(500).json({ error: 'Error interno del servidor al verificar productos.' });
    }

    const currentModifiedTime = stats.mtimeMs; // Fecha de última modificación en milisegundos

    // Si el archivo ha sido modificado desde la última carga o no está en caché
    if (currentModifiedTime > lastModifiedTime || !cachedProducts) {
      fs.readFile(localProductsPath, 'utf8', (readErr, data) => {
        if (readErr) {
          console.error('Error al leer productos.csv:', readErr);
          return res.status(500).json({ error: 'Error interno del servidor al leer productos.' });
        }

        const lines = data.split('\n').filter(line => line.trim() !== '');
        if (lines.length === 0) {
          cachedProducts = [];
          lastModifiedTime = currentModifiedTime;
          return res.json({ products: cachedProducts, lastModified: lastModifiedTime });
        }

        const products = [];
        // Definir los encabezados explícitamente ya que el CSV no tiene fila de encabezados
        const headers = ['codigo', 'nombre', 'precio', 'codigo_familia', 'nombre_familia', 'codigo_subfamilia', 'nombre_subfamilia', 'producto_asociad', 'estado'];

        // Empezar a leer desde la primera línea, ya que no hay encabezados en el archivo
        for (let i = 0; i < lines.length; i++) {
          const values = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(v => v.trim().replace(/^"|"$/g, '')); // Manejo de comas dentro de comillas y eliminación de comillas
          if (values.length === headers.length) {
            let product = {};
            for (let j = 0; j < headers.length; j++) {
              // Intentar parsear a número si es posible (solo para precio y código si aplica)
              if (headers[j] === 'precio' || headers[j] === 'codigo') {
                  product[headers[j]] = isNaN(Number(values[j])) ? values[j] : Number(values[j]);
              } else {
                  product[headers[j]] = values[j];
              }
            }
            products.push(product);
          }
        }
        console.log("Productos cargados desde CSV. Total: ", products.length);
        if (products.length > 0) {
            console.log("Primer producto parseado:", products[0]);
        }
        cachedProducts = products;
        lastModifiedTime = currentModifiedTime;
        res.json({ products: cachedProducts, lastModified: lastModifiedTime });
      });
    } else {
      // Devolver productos desde caché si no hay cambios
      res.json({ products: cachedProducts, lastModified: lastModifiedTime });
    }
  });
});

// Nueva ruta para descargar la base de productos
app.post('/descargar-productos', (req, res) => {
  const remoteSourcePath = process.env.PSCP_PRODUCTS_PATH + 'productos.csv';
  const localDbDir = path.join(__dirname, '..', 'db');
  const localProductsPath = path.join(localDbDir, 'productos.csv');

  if (!fs.existsSync(localDbDir)) {
    fs.mkdirSync(localDbDir, { recursive: true });
    console.log(`Directorio creado: ${localDbDir}`);
  }

  const privateKeyArgs = ['-pw', process.env.PSCP_PASSWORD];

  try {
    const scp_cmd = [
      'c:/faster/pscp.exe',
      '-P', process.env.PSCP_PORT_PRODUCTS,
      ...privateKeyArgs,
      `${process.env.PSCP_REMOTE_HOST}:${remoteSourcePath}`,
      localProductsPath
    ];

    console.log(`Intentando descargar ${remoteSourcePath} a ${localProductsPath}...`);

    execFile(scp_cmd[0], scp_cmd.slice(1), (error, stdout, stderr) => {
      if (error) {
        logTransfer('❌ FAILED', 'productos', remoteSourcePath, localProductsPath, stderr);
        let errorMessage = `Error al descargar productos: ${stderr}`;
        if (stderr.includes('No such file or directory')) {
          errorMessage = `El archivo productos.csv no existe en el servidor: ${remoteSourcePath}`;
        } else if (stderr.includes('Access denied') || stderr.includes('FATAL ERROR')) {
          errorMessage = `Acceso denegado o problema de autenticación SSH. Verifica la clave privada o los permisos. Detalles: ${stderr}`;
        } else if (stderr.includes('Network error') || stderr.includes('Connection refused')) {
          errorMessage = `Fallo de conexión al servidor SSH. Verifica la IP, puerto o firewall. Detalles: ${stderr}`;
        }
        console.error(errorMessage);
        return res.status(500).json({ success: false, message: errorMessage });
      }
      logTransfer('✅ SUCCESS', 'productos', remoteSourcePath, localProductsPath);
      console.log(`productos.csv descargado y guardado en ${localProductsPath}`);
      res.json({ success: true, message: 'Base de productos actualizada correctamente.' });
    });
  } catch (err) {
    logTransfer('❌ ERROR', 'productos', remoteSourcePath, localProductsPath, err.message);
    return res.status(500).json({ error: 'Error al ejecutar la descarga', details: err.message });
  }
});

// Función para verificar la existencia de PSCP
function verificarPSCP() {
  if (!fs.existsSync(PSCP_PATH)) {
    console.error(`❌ PSCP no encontrado en: ${PSCP_PATH}`);
    return false;
  }
  console.log(`✅ PSCP encontrado en: ${PSCP_PATH}`);
  return true;
}

// Función para transferir archivo con PSCP
async function transferirArchivo(archivoLocal, archivoRemoto) {
  return new Promise((resolve, reject) => {
    // Verificar que el archivo local existe
    if (!fs.existsSync(archivoLocal)) {
      const error = `❌ Archivo local no encontrado: ${archivoLocal}`;
      console.error(error);
      return reject(new Error(error));
    }

    // Verificar el contenido del archivo antes de enviar
    const fileContent = fs.readFileSync(archivoLocal, 'utf8');
    console.log(`📄 Contenido del archivo a enviar:\n${fileContent}`);

    // Construir el comando PSCP
    const transfer_cmd = [
      PSCP_PATH,
      '-P', PSCP_PORT,
      '-pw', PSCP_PASSWORD,
      archivoLocal,
      `${REMOTE_HOST}:${REMOTE_PATH}${archivoRemoto}`
    ];

    const comando = transfer_cmd.join(' ');
    console.log(`📤 Comando PSCP completo: ${comando}`);

    // Crear archivo de log detallado
    const logPath = path.join(__dirname, 'transferencias.log');
    const timestamp = new Date().toISOString();
    const logEntry = `\n[${timestamp}] Transferencia iniciada:
Archivo local: ${archivoLocal}
Archivo remoto: ${REMOTE_PATH}${archivoRemoto}
Comando: ${comando}
Contenido del archivo:
${fileContent}
------------------------\n`;

    // Ejecutar PSCP con manejo detallado de errores
    exec(comando, (error, stdout, stderr) => {
      // Agregar resultado al log
      const resultadoLog = `Resultado:
stdout: ${stdout}
stderr: ${stderr}
Error: ${error ? error.message : 'Ninguno'}
------------------------\n`;
      
      fs.appendFileSync(logPath, logEntry + resultadoLog);

      if (error) {
        console.error(`❌ Error en transferencia: ${error.message}`);
        console.error(`stderr: ${stderr}`);
        return reject(new Error(`Error en transferencia: ${error.message}`));
      }

      if (stderr) {
        console.warn(`⚠️ Advertencias en transferencia: ${stderr}`);
      }

      // Verificar que el archivo se envió correctamente
      console.log(`✅ Transferencia completada: ${archivoRemoto}`);
      console.log(`stdout: ${stdout}`);

      // Intentar verificar el archivo en el servidor remoto
      const verify_cmd = [
        PSCP_PATH,
        '-P', PSCP_PORT,
        '-pw', PSCP_PASSWORD,
        `${REMOTE_HOST}:${REMOTE_PATH}${archivoRemoto}`,
        `${archivoLocal}.verify`
      ];

      exec(verify_cmd.join(' '), (verifyError, verifyStdout, verifyStderr) => {
        if (verifyError) {
          console.warn(`⚠️ No se pudo verificar el archivo en el servidor remoto: ${verifyError.message}`);
        } else {
          console.log(`✅ Archivo verificado en el servidor remoto`);
        }
        resolve();
      });
    });
  });
}

// Endpoint para actualizar productos de una mesa (usado por gerencia para eliminar productos)
app.put('/mesas/:mesaId/productos', (req, res) => {
  const mesaId = req.params.mesaId;
  const { productos: updatedProducts, garzon: idGarzon } = req.body;
  const mesaPath = path.join(MESAS_DIR, `mesa-${mesaId}.json`);

  console.log(`[PUT /mesas/:mesaId/productos Debug] Solicitud para actualizar productos de mesa ${mesaId}.`);
  console.log(`[PUT /mesas/:mesaId/productos Debug] Productos recibidos:`, updatedProducts && updatedProducts.length > 0 ? updatedProducts.map(p => p.codigo).join(', ') : 'Ninguno');

  if (!mesaId || updatedProducts === undefined || !idGarzon) {
    logAdminAction('ERROR', 'Actualizar Productos', `Mesa ${mesaId}`, `Datos incompletos para actualizar productos.`, 'Admin');
    return res.status(400).json({ error: 'Datos incompletos para actualizar productos.' });
  }

  try {
    if (!fs.existsSync(mesaPath)) {
      logAdminAction('ERROR', 'Actualizar Productos', `Mesa ${mesaId}`, `Mesa no encontrada para actualizar productos.`, 'Admin');
      return res.status(404).json({ error: 'Mesa no encontrada.' });
    }

    const mesa = JSON.parse(fs.readFileSync(mesaPath, 'utf8'));
    // Solo permitir si el id-garzon coincide
    if (mesa.garzon !== idGarzon) {
      logAdminAction('FAIL', 'Actualizar Productos', `Mesa ${mesaId}`, `Intento de edición por garzón diferente.`, 'Admin');
      return res.status(403).json({ error: 'Solo el garzón que abrió la mesa puede editarla.' });
    }
    mesa.productos = updatedProducts;
    fs.writeFileSync(mesaPath, JSON.stringify(mesa, null, 2));
    console.log(`[PUT /mesas/:mesaId/productos Debug] Productos de mesa ${mesaId} actualizados en ${mesaPath}.`);
    logAdminAction('SUCCESS', 'Actualizar Productos', `Mesa ${mesaId}`, `Productos de mesa actualizados.`, 'Admin');
    res.json({ success: true, message: 'Productos de mesa actualizados correctamente.' });
  } catch (error) {
    console.error(`❌ [PUT /mesas/:mesaId/productos Debug] Error al actualizar productos de mesa ${mesaId}:`, error);
    logAdminAction('ERROR', 'Actualizar Productos', `Mesa ${mesaId}`, `Error al actualizar productos: ${error.message}`, 'Admin');
    res.status(500).json({ error: 'Error interno del servidor al actualizar productos.', details: error.message });
  }
});

// Endpoint para iniciar comanda TXT al abrir la mesa (solo encabezado)
app.post('/iniciar-comanda-txt', (req, res) => {
  // LOG DETALLADO DE LO QUE LLEGA
  console.log("[DEBUG] Recibido para iniciar-comanda:", req.body);

  // Permitir ambos: 'garzon' (nombre) y 'id-garzon' (id real)
  const { mesa, garzon, personas, horaApertura, 'id-garzon': idGarzonBody } = req.body;

  // Validar campos básicos
  if (!mesa || (!garzon && !idGarzonBody) || !personas || !horaApertura) {
    return res.status(400).json({ error: 'Faltan datos para iniciar comanda TXT.' });
  }

  // Determinar el id-garzon real
  let idGarzon = null;
  const garzonesPath = path.join(__dirname, 'garzones.json');
  if (idGarzonBody) {
    // Si viene explícitamente el id-garzon, usarlo y validar que exista
    if (fs.existsSync(garzonesPath)) {
      const garzonesData = fs.readFileSync(garzonesPath, 'utf8');
      const garzones = JSON.parse(garzonesData);
      for (const datos of Object.values(garzones)) {
        if (datos["id-garzon"] === idGarzonBody) {
          idGarzon = datos["id-garzon"];
          break;
        }
      }
    }
  } else if (garzon) {
    // Si solo viene el nombre, buscar el id-garzon correspondiente
    if (fs.existsSync(garzonesPath)) {
      const garzonesData = fs.readFileSync(garzonesPath, 'utf8');
      const garzones = JSON.parse(garzonesData);
      if (garzones[garzon] && garzones[garzon]["id-garzon"]) {
        idGarzon = garzones[garzon]["id-garzon"];
      }
    }
  }

  // Validar id-garzon
  if (!idGarzon || typeof idGarzon !== 'string' || idGarzon.length === 0) {
    const warnMsg = `[iniciar-comanda-txt] id-garzon ausente o inválido para mesa ${mesa} (recibido: ${idGarzonBody || garzon})`;
    console.warn(warnMsg);
    logAdminAction('WARN', 'Iniciar Comanda TXT', `Mesa ${mesa}`, warnMsg, 'Backend');
    return res.status(400).json({ error: 'No se puede iniciar la comanda: id-garzon ausente o inválido.' });
  }

  // LOG de éxito
  console.log(`✅ [POST /iniciar-comanda-txt] Mesa ${mesa} abierta por garzón=${garzon}, id-garzon=${idGarzon}`);

  const mesaIdFormatted = String(mesa).padStart(2, '0');
  const garzonFormatted = String(idGarzon).padStart(2, '0');
  const personasFormatted = String(personas).padStart(2, '0');

  let txtContent = `/header\n`;
  txtContent += `${mesaIdFormatted}\n`;
  txtContent += `${garzonFormatted}\n`;
  txtContent += `${personasFormatted}\n`;
  txtContent += `${horaApertura}\n`;
  txtContent += `/detalle\n`;

  const pedidosDir = path.join(__dirname, 'pedidos');
  if (!fs.existsSync(pedidosDir)) {
    fs.mkdirSync(pedidosDir, { recursive: true });
    console.log(`Directorio creado: ${pedidosDir}`);
  }

  const fileName = `m${mesa}.txt`;
  const outputPath = path.join(pedidosDir, fileName);

  fs.writeFileSync(outputPath, txtContent);
  console.log(`Archivo de comanda TXT para mesa ${mesa} iniciado en: ${outputPath}`);
  res.json({ ok: true, message: 'Archivo de comanda TXT iniciado correctamente.' });
});

// Endpoint para obtener los modificadores
app.get('/modificadores', isAuthenticated, (req, res) => {
  console.log('[GET /modificadores Debug] Solicitud recibida para cargar modificadores.');
  try {
    const modificadoresPath = path.join(__dirname, 'modificadores.json');
    
    if (!fs.existsSync(modificadoresPath)) {
      console.log('[GET /modificadores Debug] Archivo de modificadores no encontrado, creando uno nuevo.');
      // Crear archivo con modificadores por defecto
      const modificadoresDefault = [
        {
          "tipo": "producto",
          "codigo": "720",
          "pregunta": "¿Punto de cocción?",
          "opciones": ["Inglesa", "A Punto", "3/4", "Bien cocido"]
        },
        {
          "tipo": "subfamilia",
          "codigo": "0101",
          "pregunta": "¿Desea queso?",
          "opciones": ["Cheddar", "Mantecoso", "Sin queso"]
        },
        {
          "tipo": "familia",
          "codigo": "01",
          "pregunta": "¿Acompañamiento?",
          "opciones": ["Papas fritas", "Ensalada", "Nada"]
        }
      ];
      fs.writeFileSync(modificadoresPath, JSON.stringify(modificadoresDefault, null, 2));
      return res.json(modificadoresDefault);
    }
    
    const contenido = fs.readFileSync(modificadoresPath, 'utf8');
    const modificadores = JSON.parse(contenido);
    console.log('[GET /modificadores Debug] Modificadores cargados exitosamente.');
    res.json(modificadores);
  } catch (error) {
    console.error('❌ [GET /modificadores Debug] Error al leer modificadores:', error);
    res.status(500).json({ error: 'Error al cargar modificadores.', details: error.message });
  }
});

// Endpoint para guardar los modificadores
app.post('/modificadores', isAuthenticated, (req, res) => {
  console.log('[POST /modificadores Debug] Solicitud recibida para guardar modificadores.');
  try {
    const modificadores = req.body;
    const modificadoresPath = path.join(__dirname, 'modificadores.json');
    
    // Validar la estructura de los modificadores
    if (!Array.isArray(modificadores)) {
      throw new Error('Los modificadores deben ser un array');
    }
    
    modificadores.forEach(mod => {
      if (!mod.tipo || !mod.codigo || !mod.pregunta || !Array.isArray(mod.opciones)) {
        throw new Error('Estructura de modificador inválida');
      }
    });
    
    // Guardar los modificadores
    fs.writeFileSync(modificadoresPath, JSON.stringify(modificadores, null, 2));
    console.log('[POST /modificadores Debug] Modificadores guardados exitosamente.');
    res.json({ success: true, message: 'Modificadores guardados correctamente.' });
  } catch (error) {
    console.error('❌ [POST /modificadores Debug] Error al guardar modificadores:', error);
    res.status(500).json({ error: 'Error al guardar modificadores.', details: error.message });
  }
});

// Endpoint para cerrar mesa y generar archivo .txt con estructura /header y /estado
app.post('/cerrar-mesa', isAuthenticated, async (req, res) => {
  try {
    const { mesa, personas, horaApertura } = req.body;
    if (!mesa || !personas || !horaApertura) {
      console.error('❌ [POST /cerrar-mesa Debug] Datos faltantes:', { mesa, personas, horaApertura });
      return res.status(400).json({ error: 'Faltan datos para cerrar la mesa.' });
    }

    // Leer la mesa para obtener el id-garzon
    const mesaPath = path.join(MESAS_DIR, `mesa-${mesa}.json`);
    if (!fs.existsSync(mesaPath)) {
      console.error(`[POST /cerrar-mesa Debug] No existe el archivo de la mesa ${mesaPath}`);
      return res.status(404).json({ error: 'No existe la mesa para cerrar.' });
    }
    const mesaData = JSON.parse(fs.readFileSync(mesaPath, 'utf8'));
    const idGarzon = mesaData['id-garzon'];
    if (!idGarzon || typeof idGarzon !== 'string' || idGarzon.length === 0) {
      const warnMsg = `[POST /cerrar-mesa Debug] id-garzon ausente o inválido para mesa ${mesa}`;
      console.warn(warnMsg);
      logAdminAction('WARN', 'Cerrar Mesa', `Mesa ${mesa}`, warnMsg, 'Backend');
      return res.status(400).json({ error: 'No se puede cerrar la mesa: id-garzon ausente o inválido.' });
    }

    // Formatear datos según la estructura requerida
    const mesaIdFormatted = String(mesa).padStart(2, '0');
    const garzonFormatted = String(idGarzon).padStart(2, '0'); // id-garzon
    const personasFormatted = String(personas).padStart(2, '0');
    let formattedHoraApertura = '000000';
    if (horaApertura) {
      const parts = String(horaApertura).split(':');
      const h = parts[0] ? String(parts[0]).padStart(2, '0') : '00';
      const m = parts[1] ? String(parts[1]).padStart(2, '0') : '00';
      const s = parts[2] ? String(parts[2]).padStart(2, '0') : '00';
      formattedHoraApertura = `${h}${m}${s}`;
    }

    // Generar contenido del archivo .txt con estructura /header y /estado
    const txtContent = `/header\n${mesaIdFormatted}\n${garzonFormatted}\n${personasFormatted}\n${formattedHoraApertura}\n/estado\n`;

    console.log(`📝 [POST /cerrar-mesa Debug] Datos formateados: Mesa=${mesaIdFormatted}, Garzón=${garzonFormatted}, Personas=${personasFormatted}, Hora=${formattedHoraApertura}`);

    // Crear directorio temporal si no existe
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      console.log(`📁 [POST /cerrar-mesa Debug] Creando directorio temporal: ${tempDir}`);
      fs.mkdirSync(tempDir);
    } else {
      console.log(`📁 [POST /cerrar-mesa Debug] Directorio temporal ya existe: ${tempDir}`);
    }

    // Generar nombre de archivo con timestamp
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timestampedFileName = `m${mesa}${hours}${minutes}${seconds}.txt`;

    const outputPath = path.join(tempDir, timestampedFileName);
    
    console.log(`📁 [POST /cerrar-mesa Debug] Ruta local del archivo: ${outputPath}`);
    console.log(`📁 [POST /cerrar-mesa Debug] Nombre del archivo remoto: ${timestampedFileName}`);
    console.log(`📁 [POST /cerrar-mesa Debug] Ruta remota completa: ${REMOTE_PATH}${timestampedFileName}`);
    
    // Guardar archivo
    fs.writeFileSync(outputPath, txtContent);
    console.log(`✅ [POST /cerrar-mesa Debug] Archivo guardado localmente: ${outputPath}`);
    
    // Verificar que el archivo se creó correctamente
    if (fs.existsSync(outputPath)) {
      const fileSize = fs.statSync(outputPath).size;
      const fileContent = fs.readFileSync(outputPath, 'utf8');
      console.log(`✅ [POST /cerrar-mesa Debug] Archivo verificado: Tamaño=${fileSize} bytes, Contenido coincide: ${fileContent === txtContent}`);
    } else {
      throw new Error('El archivo no se creó correctamente');
    }

    // Transferir archivo al backend antiguo usando la misma función que las comandas
    console.log(`📤 [POST /cerrar-mesa Debug] Iniciando transferencia del archivo...`);
    await transferirArchivo(outputPath, timestampedFileName);
    console.log(`✅ [POST /cerrar-mesa Debug] Archivo transferido exitosamente: ${timestampedFileName}`);

    // Registrar la transferencia en el log de transferencias
    logTransfer('✅ SUCCESS', 'cierre-mesa', outputPath, `${REMOTE_PATH}${timestampedFileName}`, `Archivo de cierre enviado para mesa ${mesa} por garzón ${idGarzon} (esperando confirmación del Linux)`);

    // Limpiar archivo temporal después de un breve delay
    setTimeout(() => {
      try {
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
          console.log(`🧹 [POST /cerrar-mesa Debug] Archivo temporal eliminado: ${outputPath}`);
        }
      } catch (error) {
        console.error(`❌ [POST /cerrar-mesa Debug] Error al eliminar archivo temporal: ${error.message}`);
      }
    }, 5000);

    console.log(`🎉 [POST /cerrar-mesa Debug] Proceso de cierre completado exitosamente para mesa ${mesa}`);

    res.json({ 
      success: true, 
      message: `Archivo de cierre enviado: ${timestampedFileName}`,
      mesa: mesa,
      details: {
        localPath: outputPath,
        remotePath: `${REMOTE_PATH}${timestampedFileName}`,
        timestamp: new Date().toISOString(),
        fileContent: txtContent
      }
    });

  } catch (error) {
    console.error('❌ [POST /cerrar-mesa Debug] Error en el proceso de cierre:', error);
    console.error('❌ [POST /cerrar-mesa Debug] Stack trace:', error.stack);
    
    // Registrar el error en el log de transferencias
    logTransfer('❌ FAILED', 'cierre-mesa', 'N/A', 'N/A', error.message);
    
    res.status(500).json({ 
      error: error.message,
      details: {
        timestamp: new Date().toISOString(),
        stack: error.stack
      }
    });
  }
});

// Endpoint para consultar el estado de una mesa específica
app.get('/estado-mesa/:mesaId', (req, res) => {
  const mesaId = req.params.mesaId;
  console.log(`🔍 [GET /estado-mesa/:mesaId Debug] Consultando estado de mesa: ${mesaId}`);
  
  try {
    const mesaPath = path.join(__dirname, 'mesas_abiertas', `mesa-${mesaId}.json`);
    console.log(`📁 [GET /estado-mesa/:mesaId Debug] Ruta del archivo de mesa: ${mesaPath}`);
    
    if (!fs.existsSync(mesaPath)) {
      // Mesa no existe, probablemente ya fue cerrada
      console.log(`✅ [GET /estado-mesa/:mesaId Debug] Mesa ${mesaId} no encontrada - Estado: pagada`);
      res.json({ mesa: mesaId, estado: "pagada" });
    } else {
      // Mesa existe, está pendiente de pago
      console.log(`⏳ [GET /estado-mesa/:mesaId Debug] Mesa ${mesaId} encontrada - Estado: pendiente`);
      
      // Leer información de la mesa para el log
      try {
        const mesaData = JSON.parse(fs.readFileSync(mesaPath, 'utf8'));
        console.log(`📋 [GET /estado-mesa/:mesaId Debug] Información de mesa ${mesaId}: Garzón=${mesaData.garzon}, Personas=${mesaData.personas}, Productos=${mesaData.productos?.length || 0}`);
      } catch (readError) {
        console.warn(`⚠️ [GET /estado-mesa/:mesaId Debug] No se pudo leer información de mesa ${mesaId}: ${readError.message}`);
      }
      
      res.json({ mesa: mesaId, estado: "pendiente" });
    }
  } catch (error) {
    console.error(`❌ [GET /estado-mesa/:mesaId Debug] Error al consultar estado de mesa ${mesaId}:`, error);
    res.status(500).json({ error: 'Error al consultar estado de mesa', details: error.message });
  }
});

// Endpoint para consultar logs de cierre de mesa específica
app.get('/logs-cierre-mesa/:mesaId', (req, res) => {
  const mesaId = req.params.mesaId;
  console.log(`📋 [GET /logs-cierre-mesa/:mesaId Debug] Consultando logs de cierre para mesa: ${mesaId}`);
  
  try {
    // Leer el archivo de logs del día actual
    const logFilePath = getLogFilePath();
    let logs = '';
    
    if (fs.existsSync(logFilePath)) {
      const logContent = fs.readFileSync(logFilePath, 'utf8');
      const lines = logContent.split('\n');
      
      // Filtrar líneas relacionadas con la mesa específica
      const mesaLogs = lines.filter(line => 
        line.includes(`Mesa ${mesaId}`) || 
        line.includes(`cierre-mesa`) ||
        line.includes(`/cerrar-mesa`) ||
        line.includes(`estado-mesa/${mesaId}`)
      );
      
      logs = mesaLogs.join('\n');
    }
    
    // También leer el archivo de transferencias
    const transferenciasPath = path.join(__dirname, 'transferencias.log');
    let transferenciasLogs = '';
    
    if (fs.existsSync(transferenciasPath)) {
      const transferenciasContent = fs.readFileSync(transferenciasPath, 'utf8');
      const lines = transferenciasContent.split('\n');
      
      // Filtrar líneas relacionadas con la mesa específica
      const mesaTransferencias = lines.filter(line => 
        line.includes(`m${mesaId}`) || 
        line.includes(`Mesa ${mesaId}`) ||
        line.includes(`cierre-mesa`)
      );
      
      transferenciasLogs = mesaTransferencias.join('\n');
    }
    
    // Combinar logs
    const allLogs = `=== LOGS DE CIERRE DE MESA ${mesaId} ===\n\n` +
                   `📅 Logs del sistema:\n${logs || 'No hay logs del sistema para esta mesa'}\n\n` +
                   `📤 Logs de transferencias:\n${transferenciasLogs || 'No hay logs de transferencias para esta mesa'}\n\n` +
                   `⏰ Timestamp: ${new Date().toISOString()}`;
    
    console.log(`✅ [GET /logs-cierre-mesa/:mesaId Debug] Logs consultados para mesa ${mesaId}`);
    
    res.json({ 
      success: true, 
      mesa: mesaId, 
      logs: allLogs,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`❌ [GET /logs-cierre-mesa/:mesaId Debug] Error al consultar logs de mesa ${mesaId}:`, error);
    res.status(500).json({ 
      error: 'Error al consultar logs', 
      details: error.message,
      mesa: mesaId
    });
  }
});

/**
 * Endpoint: GET /cuenta-pdf/:mesaId
 * Genera un PDF de la cuenta de la mesa indicada a partir del HTML y lo sirve como descarga directa.
 * Requiere puppeteer instalado.
 * El QR puede apuntar a este endpoint para que el cliente descargue el PDF.
 */
app.get('/cuenta-pdf/:mesaId', async (req, res) => {
  const mesaId = req.params.mesaId;
  try {
    // Ruta del HTML generado previamente
    const cuentaHtmlPath = path.join(__dirname, '..', 'frontend', 'cuentas', `mesa-${mesaId}.html`);
    if (!fs.existsSync(cuentaHtmlPath)) {
      return res.status(404).send('Cuenta no encontrada');
    }
    const htmlContent = fs.readFileSync(cuentaHtmlPath, 'utf8');

    // Lanzar puppeteer y generar PDF
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 24, bottom: 24, left: 16, right: 16 }
    });
    await browser.close();

    // Enviar PDF como descarga
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="cuenta-mesa-${mesaId}.pdf"`
    });
    res.send(pdfBuffer);
  } catch (err) {
    console.error('❌ Error generando PDF:', err);
    res.status(500).send('Error generando PDF');
  }
});

// Endpoint para consultar logs de curl entrantes del endpoint /estado-mesa
app.get('/logs-curl-entrante/:mesaId?', (req, res) => {
  const mesaId = req.params.mesaId;
  console.log(`📋 [GET /logs-curl-entrante Debug] Consultando logs de curl entrante${mesaId ? ` para mesa: ${mesaId}` : ' (todas las mesas)'}`);
  
  try {
    // Leer el archivo de logs del día actual
    const logFilePath = getLogFilePath();
    let logs = '';
    
    if (fs.existsSync(logFilePath)) {
      const logContent = fs.readFileSync(logFilePath, 'utf8');
      const lines = logContent.split('\n');
      
      // Filtrar líneas relacionadas con curl entrante
      let curlLogs = [];
      let currentLog = '';
      let inCurlLog = false;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Detectar inicio de log de curl entrante
        if (line.includes('CURL ENTRANTE /estado-mesa:')) {
          inCurlLog = true;
          currentLog = line + '\n';
          continue;
        }
        
        // Si estamos en un log de curl, acumular líneas
        if (inCurlLog) {
          currentLog += line + '\n';
          
          // Detectar fin del log (línea con guiones)
          if (line.includes('--------')) {
            inCurlLog = false;
            
            // Si se especifica una mesa, filtrar por ella
            if (!mesaId || currentLog.includes(`mesa=${mesaId}`) || currentLog.includes(`"mesa":"${mesaId}"`)) {
              curlLogs.push(currentLog);
            }
            currentLog = '';
          }
        }
      }
      
      logs = curlLogs.join('\n');
    }
    
    // También buscar en logs de admin actions relacionados con estado mesa
    const adminLogs = [];
    if (fs.existsSync(logFilePath)) {
      const logContent = fs.readFileSync(logFilePath, 'utf8');
      const lines = logContent.split('\n');
      
      const estadoMesaLogs = lines.filter(line => 
        line.includes('Estado Mesa') && 
        (!mesaId || line.includes(`Mesa ${mesaId}`))
      );
      
      adminLogs.push(...estadoMesaLogs);
    }
    
    // Combinar logs
    const allLogs = `=== LOGS DE CURL ENTRANTE${mesaId ? ` - MESA ${mesaId}` : ''} ===\n\n` +
                   `📥 Logs detallados de curl:\n${logs || 'No hay logs de curl para esta consulta'}\n\n` +
                   `📋 Logs de admin actions (estado mesa):\n${adminLogs.join('\n') || 'No hay logs de admin para esta consulta'}\n\n` +
                   `⏰ Timestamp: ${new Date().toISOString()}`;
    
    console.log(`✅ [GET /logs-curl-entrante Debug] Logs consultados${mesaId ? ` para mesa ${mesaId}` : ' (todas las mesas)'}`);
    
    res.json({ 
      success: true, 
      mesa: mesaId || 'todas',
      logs: allLogs,
      timestamp: new Date().toISOString(),
      totalCurlLogs: logs.split('CURL ENTRANTE /estado-mesa:').length - 1
    });
    
  } catch (error) {
    console.error(`❌ [GET /logs-curl-entrante Debug] Error al consultar logs:`, error);
    res.status(500).json({ 
      error: 'Error al consultar logs de curl entrante', 
      details: error.message,
      mesa: mesaId
    });
  }
});

// Endpoint para consultar el estado que ha enviado el Linux para una mesa específica
app.get('/estado-linux/:mesaId', (req, res) => {
  const mesaId = req.params.mesaId;
  console.log(`🔍 [GET /estado-linux/:mesaId Debug] Consultando estado del Linux para mesa: ${mesaId}`);
  
  try {
    const estadoMesaPath = path.join(__dirname, 'temp', `estado-mesa-${mesaId}.json`);
    
    if (fs.existsSync(estadoMesaPath)) {
      const estadoData = JSON.parse(fs.readFileSync(estadoMesaPath, 'utf8'));
      console.log(`✅ [GET /estado-linux/:mesaId Debug] Estado del Linux para mesa ${mesaId}:`, estadoData);
      
      res.json({
        success: true,
        mesa: mesaId,
        estado: estadoData.estado,
        timestamp: estadoData.timestamp,
        ipOrigen: estadoData.ipOrigen,
        userAgent: estadoData.userAgent
      });
    } else {
      console.log(`⏳ [GET /estado-linux/:mesaId Debug] No hay estado del Linux para mesa ${mesaId} - aún no ha respondido`);
      res.json({
        success: true,
        mesa: mesaId,
        estado: null,
        timestamp: null,
        message: 'Linux aún no ha enviado estado para esta mesa'
      });
    }
  } catch (error) {
    console.error(`❌ [GET /estado-linux/:mesaId Debug] Error al consultar estado del Linux para mesa ${mesaId}:`, error);
    res.status(500).json({ 
      error: 'Error al consultar estado del Linux', 
      details: error.message,
      mesa: mesaId
    });
  }
});

// Endpoint para limpiar el archivo de estado del Linux después de cerrar la mesa
app.delete('/limpiar-estado-linux/:mesaId', (req, res) => {
  const mesaId = req.params.mesaId;
  console.log(`🧹 [DELETE /limpiar-estado-linux/:mesaId Debug] Limpiando archivo de estado del Linux para mesa: ${mesaId}`);
  
  try {
    const estadoMesaPath = path.join(__dirname, 'temp', `estado-mesa-${mesaId}.json`);
    
    if (fs.existsSync(estadoMesaPath)) {
      fs.unlinkSync(estadoMesaPath);
      console.log(`✅ [DELETE /limpiar-estado-linux/:mesaId Debug] Archivo de estado del Linux eliminado para mesa ${mesaId}`);
      logAdminAction('SUCCESS', 'Limpiar Estado Linux', `Mesa ${mesaId}`, 'Archivo de estado del Linux eliminado', 'Frontend');
      res.json({ success: true, message: `Archivo de estado del Linux eliminado para mesa ${mesaId}` });
    } else {
      console.log(`⚠️ [DELETE /limpiar-estado-linux/:mesaId Debug] Archivo de estado del Linux no encontrado para mesa ${mesaId}`);
      logAdminAction('WARNING', 'Limpiar Estado Linux', `Mesa ${mesaId}`, 'Archivo de estado del Linux no encontrado', 'Frontend');
      res.json({ success: true, message: `Archivo de estado del Linux no encontrado para mesa ${mesaId}` });
    }
  } catch (error) {
    console.error(`❌ [DELETE /limpiar-estado-linux/:mesaId Debug] Error al limpiar archivo de estado del Linux para mesa ${mesaId}:`, error);
    logAdminAction('ERROR', 'Limpiar Estado Linux', `Mesa ${mesaId}`, `Error al limpiar archivo: ${error.message}`, 'Frontend');
    res.status(500).json({ 
      error: 'Error al limpiar archivo de estado del Linux', 
      details: error.message,
      mesa: mesaId
    });
  }
});

// ===== FUNCIONES PARA SISTEMA DE AUTENTICACIÓN =====

// Función para obtener la IP del cliente
function getClientIP(req) {
  return req.headers['x-forwarded-for'] || 
         req.connection.remoteAddress || 
         req.socket.remoteAddress ||
         (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
         req.ip;
}

// Función para obtener la MAC address (simulada para desarrollo)
function getClientMAC(req) {
  // En desarrollo, usar una MAC simulada basada en la IP
  // En producción, usar getmac o arp-a
  const ip = getClientIP(req);
  const ipParts = ip.split('.');
  if (ipParts.length === 4) {
    // Generar una MAC basada en la IP para desarrollo
    const macParts = ipParts.map(part => {
      const hex = parseInt(part).toString(16).padStart(2, '0');
      return hex.toUpperCase();
    });
    return `${macParts[0]}:${macParts[1]}:${macParts[2]}:${macParts[3]}:00:01`;
  }
  return '00:00:00:00:00:00'; // MAC por defecto
}

const arpGetMAC = util.promisify(arp.getMAC);

// Helper functions for device tracking
function getClientIp(req) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  // Clean up IPv6 mapped IPv4 addresses like ::ffff:192.168.1.1
  if (ip && ip.startsWith('::ffff:')) {
    return ip.substring(7);
  }
  return ip;
}

async function getClientMac(ip) {
  if (!ip) return null;
  // Handle localhost which won't be in ARP cache, common in development
  if (['::1', '127.0.0.1'].includes(ip)) {
    return 'localhost_mac'; // Placeholder for local testing
  }
  try {
    const mac = await arpGetMAC(ip);
    return mac;
  } catch (err) {
    // This can happen for public IPs or if the local ARP cache is empty for that IP.
    console.warn(`[WARN] Could not retrieve MAC address for IP ${ip}. Error: ${err.message}`);
    return null;
  }
}

// Helper function to load JSON files
function loadJSON(filename) {
  const filePath = path.join(__dirname, filename);
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`❌ Error al leer archivo JSON: ${filename}`, error);
    return {};
  }
}

const dispositivosPath = path.join(__dirname, 'dispositivos.json');

// Helper para cargar dispositivos.json
function loadDispositivos() {
  if (!fs.existsSync(dispositivosPath)) {
    fs.writeFileSync(dispositivosPath, JSON.stringify({}));
    return {};
  }
  try {
    const data = fs.readFileSync(dispositivosPath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error al leer dispositivos.json:', error);
    return {};
  }
}

// Helper para guardar en dispositivos.json
function saveDispositivos(dispositivos) {
  try {
    fs.writeFileSync(dispositivosPath, JSON.stringify(dispositivos, null, 2));
  } catch (error) {
    console.error('Error al guardar en dispositivos.json:', error);
  }
}

// Función para cargar usuarios desde ambos archivos JSON
function loadAllUsers() {
  const garzonesPath = path.join(__dirname, 'garzones.json');
  const administradoresPath = path.join(__dirname, 'administradores.json');
  let allUsers = {};

  try {
    if (fs.existsSync(garzonesPath)) {
      const garzonesData = fs.readFileSync(garzonesPath, 'utf8');
      Object.assign(allUsers, JSON.parse(garzonesData));
    }
  } catch (error) {
    console.error('Error al cargar garzones.json:', error);
  }

  try {
    if (fs.existsSync(administradoresPath)) {
      const adminData = fs.readFileSync(administradoresPath, 'utf8');
      Object.assign(allUsers, JSON.parse(adminData));
    }
  } catch (error) {
    console.error('Error al cargar administradores.json:', error);
  }
  
  return allUsers;
}

// Middleware para verificar autenticación
function isAuthenticated(req, res, next) {
  if (req.session && req.session.usuario) {
    return next();
  }
  res.status(401).json({ error: 'No autenticado' });
}

// Función para verificar estado del dispositivo
function checkDispositivo(req) {
  const mac = getClientMAC(req);
  const ip = getClientIP(req);
  const dispositivos = loadDispositivos();
  
  if (dispositivos[mac]) {
    return dispositivos[mac];
  }
  
  // Dispositivo nuevo
  return {
    ip: ip,
    estado: 'pendiente',
    usuario: null,
    fecha_registro: new Date().toISOString(),
    ultimo_acceso: new Date().toISOString()
  };
}

// ===== ENDPOINT PARA ACCIONES DE ADMINISTRADOR =====

// Endpoint para acciones de administrador (anular/mover productos)
app.post('/admin-action', isAuthenticated, async (req, res) => {
  const { action, mesaOrigen, mesaDestino, productIndex, motivo, txtContent } = req.body;
  
  console.log(`🔧 [POST /admin-action Debug] Acción de administrador recibida:`, {
    action,
    mesaOrigen,
    mesaDestino,
    productIndex,
    motivo: motivo ? motivo.substring(0, 50) + '...' : 'Sin motivo',
    txtContentLength: txtContent ? txtContent.length : 0
  });

  try {
    // Validar datos requeridos
    if (!action || !mesaOrigen || productIndex === undefined || !motivo) {
      throw new Error('Faltan datos requeridos para la acción de administrador');
    }

    if (action !== 'anular' && action !== 'mover') {
      throw new Error('Acción no válida. Solo se permiten: anular, mover');
    }

    if (action === 'mover' && !mesaDestino) {
      throw new Error('Para mover un producto debe especificar la mesa destino');
    }

    // Cargar la mesa origen
    const mesaOrigenPath = path.join(MESAS_DIR, `mesa-${mesaOrigen}.json`);
    if (!fs.existsSync(mesaOrigenPath)) {
      throw new Error(`Mesa ${mesaOrigen} no encontrada`);
    }

    const mesaOrigenData = JSON.parse(fs.readFileSync(mesaOrigenPath, 'utf8'));
    
    // Verificar que el producto existe
    if (!mesaOrigenData.productos || !mesaOrigenData.productos[productIndex]) {
      throw new Error(`Producto en índice ${productIndex} no encontrado en mesa ${mesaOrigen}`);
    }

    const producto = mesaOrigenData.productos[productIndex];

    // Si es movimiento, verificar que la mesa destino existe
    if (action === 'mover') {
      const mesaDestinoPath = path.join(MESAS_DIR, `mesa-${mesaDestino}.json`);
      if (!fs.existsSync(mesaDestinoPath)) {
        throw new Error(`Mesa destino ${mesaDestino} no encontrada`);
      }

      if (mesaOrigen === mesaDestino) {
        throw new Error('No puede mover un producto a la misma mesa');
      }
    }

    // Generar nombre de archivo único
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const actionType = action === 'anular' ? 'anulacion' : 'cambio';
    const fileName = `admin-${actionType}-mesa${mesaOrigen}-${timestamp}.txt`;
    const filePath = path.join(__dirname, 'temp', fileName);

    // Guardar archivo TXT
    fs.writeFileSync(filePath, txtContent, 'utf8');
    console.log(`📄 [POST /admin-action Debug] Archivo TXT generado: ${fileName}`);

    // Procesar la acción según el tipo
    if (action === 'anular') {
      // Eliminar el producto de la mesa origen
      mesaOrigenData.productos.splice(productIndex, 1);
      
      // Guardar mesa actualizada
      fs.writeFileSync(mesaOrigenPath, JSON.stringify(mesaOrigenData, null, 2), 'utf8');
      
      console.log(`✅ [POST /admin-action Debug] Producto anulado de mesa ${mesaOrigen}`);
      logAdminAction('SUCCESS', 'Anular Producto', `Mesa ${mesaOrigen}`, 
        `Producto "${producto.nombre}" anulado. Motivo: ${motivo}`, 'Admin');

    } else if (action === 'mover') {
      // Cargar mesa destino
      const mesaDestinoPath = path.join(MESAS_DIR, `mesa-${mesaDestino}.json`);
      const mesaDestinoData = JSON.parse(fs.readFileSync(mesaDestinoPath, 'utf8'));
      
      // Agregar producto a mesa destino
      if (!mesaDestinoData.productos) {
        mesaDestinoData.productos = [];
      }
      mesaDestinoData.productos.push(producto);
      
      // Eliminar producto de mesa origen
      mesaOrigenData.productos.splice(productIndex, 1);
      
      // Guardar ambas mesas
      fs.writeFileSync(mesaOrigenPath, JSON.stringify(mesaOrigenData, null, 2), 'utf8');
      fs.writeFileSync(mesaDestinoPath, JSON.stringify(mesaDestinoData, null, 2), 'utf8');
      
      console.log(`✅ [POST /admin-action Debug] Producto movido de mesa ${mesaOrigen} a mesa ${mesaDestino}`);
      logAdminAction('SUCCESS', 'Mover Producto', `Mesa ${mesaOrigen} → Mesa ${mesaDestino}`, 
        `Producto "${producto.nombre}" movido. Motivo: ${motivo}`, 'Admin');
    }

    // Transferir archivo TXT al servidor remoto
    try {
      const remoteFileName = `admin-${actionType}-mesa${mesaOrigen}-${timestamp}.txt`;
      await transferirArchivo(fileName, remoteFileName);
      console.log(`📤 [POST /admin-action Debug] Archivo TXT transferido al servidor remoto: ${remoteFileName}`);
      logTransfer('SUCCESS', 'ADMIN_ACTION', fileName, remoteFileName, `Acción: ${action}`);
    } catch (transferError) {
      console.error(`❌ [POST /admin-action Debug] Error al transferir archivo TXT:`, transferError);
      logTransfer('ERROR', 'ADMIN_ACTION', fileName, 'REMOTE_SERVER', transferError.message);
      // No fallar la operación si la transferencia falla
    }

    // Limpiar archivo temporal después de un tiempo
    setTimeout(() => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🧹 [POST /admin-action Debug] Archivo temporal eliminado: ${fileName}`);
        }
      } catch (cleanupError) {
        console.warn(`⚠️ [POST /admin-action Debug] Error al limpiar archivo temporal:`, cleanupError);
      }
    }, 30000); // 30 segundos

    res.json({
      success: true,
      message: `Producto ${action === 'anular' ? 'anulado' : 'movido'} exitosamente`,
      action: action,
      mesaOrigen: mesaOrigen,
      mesaDestino: action === 'mover' ? mesaDestino : null,
      fileName: fileName
    });

  } catch (error) {
    console.error(`❌ [POST /admin-action Debug] Error en acción de administrador:`, error);
    logAdminAction('ERROR', action ? action.toUpperCase() : 'UNKNOWN', 
      mesaOrigen ? `Mesa ${mesaOrigen}` : 'N/A', 
      `Error: ${error.message}`, 'Admin');
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== MERCADOPAGO OAUTH ROUTES =====

// Get OAuth authorization URL
app.get('/mercadopago/auth', isAuthenticated, (req, res) => {
  try {
    if (!mercadopagoOAuth.isConfigured()) {
      return res.status(400).json({
        error: 'MercadoPago OAuth not configured',
        message: 'Please set MERCADOPAGO_CLIENT_ID and MERCADOPAGO_CLIENT_SECRET environment variables'
      });
    }

    const state = req.query.state || Math.random().toString(36).substring(7);
    const authUrl = mercadopagoOAuth.getAuthorizationUrl(state);
    
    res.json({
      success: true,
      authUrl: authUrl,
      state: state
    });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    res.status(500).json({
      error: 'Failed to generate authorization URL',
      message: error.message
    });
  }
});

// OAuth callback endpoint
app.get('/mercadopago/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error('OAuth error:', error);
      return res.status(400).json({
        error: 'OAuth authorization failed',
        message: error
      });
    }

    if (!code) {
      return res.status(400).json({
        error: 'Authorization code not provided'
      });
    }

    // Exchange code for tokens
    const tokens = await mercadopagoOAuth.exchangeCodeForToken(code);
    
    console.log('✅ MercadoPago OAuth authorization successful');
    
    // Redirect to success page or return success response
    res.json({
      success: true,
      message: 'MercadoPago authorization successful',
      user_id: tokens.user_id,
      scope: tokens.scope
    });
  } catch (error) {
    console.error('Error in OAuth callback:', error);
    res.status(500).json({
      error: 'OAuth callback failed',
      message: error.message
    });
  }
});

// Get OAuth status
app.get('/mercadopago/status', isAuthenticated, (req, res) => {
  try {
    const isConfigured = mercadopagoOAuth.isConfigured();
    const isAuthorized = mercadopagoOAuth.isAuthorized();
    const tokens = mercadopagoOAuth.loadTokens();

    res.json({
      configured: isConfigured,
      authorized: isAuthorized,
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      expiresAt: tokens.expires_at,
      userId: tokens.user_id,
      scope: tokens.scope
    });
  } catch (error) {
    console.error('Error getting OAuth status:', error);
    res.status(500).json({
      error: 'Failed to get OAuth status',
      message: error.message
    });
  }
});

// Get user information
app.get('/mercadopago/user', isAuthenticated, async (req, res) => {
  try {
    if (!mercadopagoOAuth.isAuthorized()) {
      return res.status(401).json({
        error: 'Not authorized',
        message: 'Please complete OAuth authorization first'
      });
    }

    const userInfo = await mercadopagoOAuth.getUserInfo();
    res.json({
      success: true,
      user: userInfo
    });
  } catch (error) {
    console.error('Error getting user info:', error);
    res.status(500).json({
      error: 'Failed to get user information',
      message: error.message
    });
  }
});

// Revoke OAuth access
app.post('/mercadopago/revoke', isAuthenticated, async (req, res) => {
  try {
    const success = await mercadopagoOAuth.revokeAccess();
    
    if (success) {
      res.json({
        success: true,
        message: 'Access revoked successfully'
      });
    } else {
      res.status(500).json({
        error: 'Failed to revoke access'
      });
    }
  } catch (error) {
    console.error('Error revoking access:', error);
    res.status(500).json({
      error: 'Failed to revoke access',
      message: error.message
    });
  }
});

// Test MercadoPago API connection
app.get('/mercadopago/test', isAuthenticated, async (req, res) => {
  try {
    if (!mercadopagoOAuth.isAuthorized()) {
      return res.status(401).json({
        error: 'Not authorized',
        message: 'Please complete OAuth authorization first'
      });
    }

    const accessToken = await mercadopagoOAuth.getValidAccessToken();
    
    // Test API call - get user info
    const userInfo = await mercadopagoOAuth.getUserInfo();
    
    res.json({
      success: true,
      message: 'MercadoPago API connection successful',
      user: userInfo,
      tokenValid: true
    });
  } catch (error) {
    console.error('Error testing MercadoPago API:', error);
    res.status(500).json({
      error: 'MercadoPago API test failed',
      message: error.message
    });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
}); 