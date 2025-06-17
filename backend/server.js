const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const { exec } = require('child_process');
const app = express();
const PORT = 3000;
const MESAS_DIR = path.join(__dirname, 'mesas_abiertas');

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

app.use('/frontend/css', express.static(path.join(__dirname, '..', 'frontend', 'css'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
  }
}));

// Servir archivos estáticos desde la carpeta principal del proyecto
app.use(express.static(path.join(__dirname, '..', '/frontend/views/')));

// Redirigir la raíz a inicio.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '/frontend/views/inicio.html'));
});

// Leer todas las mesas abiertas
app.get('/mesas', (req, res) => {
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
app.get('/mesas/:mesaId', (req, res) => {
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
app.post('/mesas', (req, res) => {
  const incomingMesa = req.body;
  console.log('[POST /mesas Debug] Solicitud recibida para guardar/actualizar mesa:', incomingMesa.mesa);

  if (!incomingMesa.mesa || !incomingMesa.garzon) {
    return res.status(400).json({ error: 'Faltan datos (mesa o garzón).' });
  }

  const mesaId = incomingMesa.mesa;
  const mesaPath = path.join(MESAS_DIR, `mesa-${mesaId}.json`);

  try {
    let mesaToSave = { // Inicializar con los datos de entrada
      mesa: incomingMesa.mesa,
      garzon: incomingMesa.garzon,
      productos: incomingMesa.productos || [], // Asegurar que productos es un array
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
      (incomingMesa.productos || []).forEach(newProd => { // Asegurar que incomingMesa.productos es un array
        const existingProdIndex = updatedProductos.findIndex(p => p.codigo === newProd.codigo);
        if (existingProdIndex > -1) {
          updatedProductos[existingProdIndex].cantidad = parseInt(updatedProductos[existingProdIndex].cantidad) + parseInt(newProd.cantidad);
        } else {
          updatedProductos.push(newProd);
        }
      });

      mesaToSave.productos = updatedProductos;
      mesaToSave.personas = incomingMesa.personas || existingMesa.personas;
      mesaToSave.horaApertura = existingMesa.horaApertura; // Mantener la hora original

    } else {
      // Si la mesa es nueva, mesaToSave ya está correctamente inicializada
      // con los datos recibidos en incomingMesa, incluyendo productos: [].
      // No se necesita lógica adicional aquí.
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
app.delete('/mesas/:mesaId', async (req, res) => {
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

// Endpoint para autenticación de administrador
app.post('/admin-login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    logAdminAction('ERROR', 'Login Intento', 'N/A', 'Credenciales incompletas', 'Desconocido');
    return res.status(400).json({ success: false, message: 'Usuario y clave son requeridos.' });
  }

  const credencialesPath = path.join(__dirname, '..', 'admin_credenciales.json');

  try {
    console.log(`[Admin Login Debug] Intentando autenticar usuario: ${username}`);
    console.log(`[Admin Login Debug] Directorio actual de la aplicación (process.cwd()): ${process.cwd()}`);
    console.log(`[Admin Login Debug] Directorio base del backend (__dirname): ${__dirname}`);
    console.log(`[Admin Login Debug] Ruta construida para credenciales: ${credencialesPath}`);

    if (!fs.existsSync(credencialesPath)) {
      console.error(`[Admin Login Debug] ❌ Error: El archivo de credenciales NO existe en la ruta: ${credencialesPath}`);
      logAdminAction('ERROR', 'Login Intento', 'N/A', 'Archivo de credenciales no encontrado', username);
      return res.status(500).json({ success: false, message: 'Error interno del servidor: Archivo de credenciales no encontrado.' });
    }

    const credencialesData = fs.readFileSync(credencialesPath, 'utf8');
    const credenciales = JSON.parse(credencialesData);
    console.log('[Admin Login Debug] Credenciales cargadas del archivo:', credenciales);

    const userFound = credenciales.find(c => c.usuario === username && c.clave === password);

    if (userFound) {
      logAdminAction('SUCCESS', 'Login', 'N/A', 'Autenticación exitosa', username);
      res.json({ success: true, message: 'Autenticación exitosa.' });
    } else {
      logAdminAction('FAIL', 'Login Intento', 'N/A', 'Credenciales incorrectas', username);
      res.status(401).json({ success: false, message: 'Credenciales incorrectas.' });
    }
  } catch (error) {
    console.error('❌ [Admin Login Debug] Error al leer o parsear admin_credenciales.json:', error);
    logAdminAction('ERROR', 'Login', 'N/A', `Error al leer credenciales: ${error.message}`, 'Desconocido');
    res.status(500).json({ success: false, message: 'Error interno del servidor al autenticar.' });
  }
});

// Endpoint para enviar comanda de productos
app.post('/enviar-comanda-productos', async (req, res) => {
  try {
    console.log('📥 Recibida solicitud de envío de comanda');
    console.log('Datos recibidos:', JSON.stringify(req.body, null, 2));

    // Verificar PSCP
    if (!verificarPSCP()) {
      throw new Error('Configuración de PSCP incorrecta');
    }

    const { mesa, garzon, productos, horaApertura, timestampedFileName, fileContent } = req.body;

    // Validación detallada de datos requeridos
    const datosFaltantes = [];
    if (!mesa) datosFaltantes.push('mesa');
    if (!garzon) datosFaltantes.push('garzon');
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

    // Generar archivo TXT
    const timestampedOutputPath = path.join(tempDir, timestampedFileName);
    
    // Guardar archivo - Ahora usa el contenido directamente del body
    fs.writeFileSync(timestampedOutputPath, fileContent);
    console.log(`📝 Archivo generado: ${timestampedOutputPath}`);
    console.log(`📄 Contenido del archivo:\n${fileContent}`);

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

// Endpoint para emitir cuenta y transferir CSV por SSH
app.post('/emitir-cuenta', (req, res) => {
  const { mesa, garzon, personas, horaApertura } = req.body;
  if (!mesa || !garzon || !personas || !horaApertura) return res.status(400).json({ error: 'Faltan datos' });

  // === Generar archivo de cuenta en formato TXT ===
  const mesaIdFormatted = String(mesa).padStart(2, '0');
  const garzonFormatted = String(garzon).padStart(2, '0');
  const personasFormatted = String(personas).padStart(2, '0');

  const cuentaTxtContent = `/header\n${mesaIdFormatted}\n${garzonFormatted}\n${personasFormatted}\n${horaApertura}\n/detalle\n/cuenta\n`;

  const pedidosDir = path.join(__dirname, 'pedidos');
  if (!fs.existsSync(pedidosDir)) {
    fs.mkdirSync(pedidosDir, { recursive: true });
    console.log(`Directorio creado: ${pedidosDir}`);
  }

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const fileName = `cm${mesa}${hours}${minutes}.txt`;
  const outputPath = path.join(pedidosDir, fileName);

  fs.writeFileSync(outputPath, cuentaTxtContent);
  console.log(`Archivo de cuenta TXT generado en: ${outputPath}`);

  try {
    const transfer_cmd = [
      'c:/faster/pscp.exe',
      '-P', process.env.PSCP_PORT_ORDERS,
      '-pw', process.env.PSCP_PASSWORD,
      outputPath,
      `${process.env.PSCP_REMOTE_HOST}:${process.env.PSCP_ORDERS_PATH}`
    ];

    execFile(transfer_cmd[0], transfer_cmd.slice(1), (error, stdout, stderr) => {
      fs.unlinkSync(outputPath);
      if (error) {
        logTransfer('❌ FAILED', 'cuenta', outputPath, process.env.PSCP_ORDERS_PATH, stderr);
        return res.status(500).json({ error: 'Error al transferir archivo', details: stderr });
      }
      logTransfer('✅ SUCCESS', 'cuenta', outputPath, process.env.PSCP_ORDERS_PATH);
      res.json({ ok: true, message: 'Cuenta emitida y transferida correctamente.' });
    });
  } catch (err) {
    logTransfer('❌ ERROR', 'cuenta', outputPath, process.env.PSCP_ORDERS_PATH, err.message);
    return res.status(500).json({ error: 'Error al ejecutar la transferencia', details: err.message });
  }
});

// Endpoint para recibir confirmación de pago desde el backend antiguo
app.post('/estado-mesa', express.urlencoded({ extended: true }), (req, res) => {
  console.log('[DEBUG] Headers recibidos:', req.headers);
  console.log('[DEBUG] Body recibido:', req.body);
  console.log('[DEBUG] URL completa:', req.url);
  
  // Intentar obtener mesa y estado de diferentes formas
  let mesa = req.body.mesa;
  let estado = req.body.estado;

  // Si no se encuentra en el body, intentar parsear la URL
  if (!mesa || !estado) {
    // Intentar extraer parámetros de la URL incluso si vienen en formato incorrecto
    const urlParts = req.url.split('?');
    if (urlParts.length > 1) {
      const queryString = urlParts[1].replace(/\\/g, '').trim(); // Eliminar barras invertidas y espacios
      const params = new URLSearchParams(queryString);
      mesa = mesa || params.get('mesa');
      estado = estado || params.get('estado');
    }
  }

  // Si aún no tenemos los datos, intentar extraerlos del body como string
  if (!mesa || !estado) {
    const bodyStr = JSON.stringify(req.body);
    const mesaMatch = bodyStr.match(/mesa=(\d+)/);
    const estadoMatch = bodyStr.match(/estado=(\w+)/);
    if (mesaMatch) mesa = mesaMatch[1];
    if (estadoMatch) estado = estadoMatch[1];
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

  if (estado === 'pagada') {
    // Ruta del archivo de la mesa abierta
    const mesaPath = path.join(__dirname, 'mesas_abiertas', `mesa-${mesa}.json`);

    if (fs.existsSync(mesaPath)) {
      try {
        // Leer la mesa antes de eliminarla para el log
        const mesaAEliminar = JSON.parse(fs.readFileSync(mesaPath, 'utf8'));
        fs.unlinkSync(mesaPath);
        console.log(`[✅] Mesa ${mesa} eliminada tras confirmación de pago`);
        logAdminAction('SUCCESS', 'Estado Mesa', `Mesa ${mesa}`, `Mesa eliminada tras pago. Garzón: ${mesaAEliminar.garzon}, Total: ${(mesaAEliminar.productos || []).reduce((sum, item) => sum + (parseFloat(item.precio) * (item.cantidad || 1)), 0)}`, 'Backend Antiguo');
      } catch (error) {
        console.error(`[❌] Error al eliminar mesa ${mesa}:`, error);
        logAdminAction('ERROR', 'Estado Mesa', `Mesa ${mesa}`, `Error al eliminar mesa: ${error.message}`, 'Backend Antiguo');
      }
    } else {
      console.warn(`[⚠️] Mesa ${mesa} no encontrada para cerrar`);
      logAdminAction('WARNING', 'Estado Mesa', `Mesa ${mesa}`, 'Mesa no encontrada para cerrar', 'Backend Antiguo');
    }
  } else {
    console.log(`[🕓] Mesa ${mesa} no pagada. Estado recibido: ${estado}`);
    logAdminAction('INFO', 'Estado Mesa', `Mesa ${mesa}`, `Estado recibido: ${estado}`, 'Backend Antiguo');
  }

  res.status(200).send('Estado procesado');
});

// Nueva ruta para obtener la base de productos desde el backend con caché
app.get('/productos', (req, res) => {
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
  const { productos: updatedProducts } = req.body;
  const mesaPath = path.join(MESAS_DIR, `mesa-${mesaId}.json`);

  console.log(`[PUT /mesas/:mesaId/productos Debug] Solicitud para actualizar productos de mesa ${mesaId}.`);
  console.log(`[PUT /mesas/:mesaId/productos Debug] Productos recibidos:`, updatedProducts.length > 0 ? updatedProducts.map(p => p.codigo).join(', ') : 'Ninguno');

  if (!mesaId || updatedProducts === undefined) {
    logAdminAction('ERROR', 'Actualizar Productos', `Mesa ${mesaId}`, `Datos incompletos para actualizar productos.`, 'Admin');
    return res.status(400).json({ error: 'Datos incompletos para actualizar productos.' });
  }

  try {
    if (!fs.existsSync(mesaPath)) {
      logAdminAction('ERROR', 'Actualizar Productos', `Mesa ${mesaId}`, `Mesa no encontrada para actualizar productos.`, 'Admin');
      return res.status(404).json({ error: 'Mesa no encontrada.' });
    }

    const mesa = JSON.parse(fs.readFileSync(mesaPath, 'utf8'));
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
  const { mesa, garzon, personas, horaApertura } = req.body;

  if (!mesa || !garzon || !personas || !horaApertura) {
    return res.status(400).json({ error: 'Faltan datos para iniciar comanda TXT.' });
  }

  const mesaIdFormatted = String(mesa).padStart(2, '0');
  const garzonFormatted = String(garzon).padStart(2, '0');
  const personasFormatted = String(personas).padStart(2, '0');

  let txtContent = `/header\n`;
  txtContent += `${mesaIdFormatted}\n`;
  txtContent += `${garzonFormatted}\n`;
  txtContent += `${personasFormatted}\n`;
  txtContent += `${horaApertura}\n`; // Usar la hora de apertura provista
  txtContent += `/detalle\n`; // Dejar la sección de detalle vacía inicialmente

  const pedidosDir = path.join(__dirname, 'pedidos');
  if (!fs.existsSync(pedidosDir)) {
    fs.mkdirSync(pedidosDir, { recursive: true });
    console.log(`Directorio creado: ${pedidosDir}`);
  }

  // Usar un nombre de archivo persistente para la mesa para poder agregarle después
  const fileName = `m${mesa}.txt`; // Nombre de archivo simple por mesa
  const outputPath = path.join(pedidosDir, fileName);

  fs.writeFileSync(outputPath, txtContent);
  console.log(`Archivo de comanda TXT para mesa ${mesa} iniciado en: ${outputPath}`);
  res.json({ ok: true, message: 'Archivo de comanda TXT iniciado correctamente.' });
});

// Endpoint para obtener los modificadores
app.get('/modificadores', (req, res) => {
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
app.post('/modificadores', (req, res) => {
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
}); 