const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const { execFile } = require('child_process');
const app = express();
const PORT = 3000;
const FILE = 'mesas_abiertas.json';

// Variables para el caché de productos
let cachedProducts = null;
let lastModifiedTime = 0; // Marca de tiempo de la última modificación de productos.csv

app.use(cors());
app.use(express.json());

// Servir archivos estáticos desde la carpeta principal del proyecto
app.use(express.static(path.join(__dirname, '..')));

// Redirigir la raíz a inicio.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'inicio.html'));
});

// Leer todas las mesas abiertas
app.get('/mesas', (req, res) => {
  if (!fs.existsSync(FILE)) return res.json({});
  const data = fs.readFileSync(FILE, 'utf8');
  res.json(JSON.parse(data || '{}'));
});

// Leer una mesa específica
app.get('/mesas/:mesaId', (req, res) => {
  const mesaId = req.params.mesaId;
  if (!fs.existsSync(FILE)) return res.json({});
  const data = JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}');
  const mesa = data[mesaId];
  if (mesa) {
    res.json(mesa);
  } else {
    res.status(404).json({ error: 'Mesa no encontrada.' });
  }
});

// Guardar/actualizar una mesa abierta
app.post('/mesas', (req, res) => {
  const incomingMesa = req.body; // Datos de la mesa que llegan del frontend
  if (!incomingMesa.mesa || !incomingMesa.garzon) return res.status(400).json({ error: 'Faltan datos (mesa o garzón).' });

  let currentMesas = {};
  if (fs.existsSync(FILE)) {
    currentMesas = JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}');
  }

  const mesaId = incomingMesa.mesa;
  const existingMesa = currentMesas[mesaId];

  if (existingMesa) {
    // Mesa ya existe
    if (existingMesa.garzon !== incomingMesa.garzon) {
      // Garzón diferente: bloquear acceso
      return res.status(403).json({ error: `Mesa ${mesaId} ya está siendo atendida por el garzón ${existingMesa.garzon}.` });
    } else {
      // Mismo garzón: acumular productos
      const updatedProductos = [...existingMesa.productos];
      incomingMesa.productos.forEach(newProd => {
        const existingProdIndex = updatedProductos.findIndex(p => p.codigo === newProd.codigo);
        if (existingProdIndex > -1) {
          updatedProductos[existingProdIndex].cantidad = parseInt(updatedProductos[existingProdIndex].cantidad) + parseInt(newProd.cantidad);
        } else {
          updatedProductos.push(newProd);
        }
      });
      existingMesa.productos = updatedProductos;
      existingMesa.personas = incomingMesa.personas; // Actualiza número de personas
      // No actualizamos la hora de apertura si ya existe para mantener la hora original
    }
  } else {
    // Mesa nueva: registrarla con sus datos
    currentMesas[mesaId] = incomingMesa;
  }
  
  fs.writeFileSync(FILE, JSON.stringify(currentMesas, null, 2));
  res.json({ ok: true, message: 'Mesa guardada correctamente.' });
});

// Nuevo endpoint: Iniciar comanda TXT al abrir la mesa (solo encabezado)
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

// Nuevo endpoint: Enviar comanda TXT (agregar productos y SCP)
app.post('/enviar-comanda-productos', (req, res) => {
  const { mesa, garzon, productos } = req.body;

  if (!mesa || !garzon || !productos || !Array.isArray(productos) || productos.length === 0) {
    // Si no hay productos nuevos para enviar, solo confirmamos
    console.log(`No hay productos nuevos para enviar en la comanda de la mesa ${mesa}.`);
    return res.json({ ok: true, message: 'No hay productos nuevos para enviar.' });
  }

  const pedidosDir = path.join(__dirname, 'pedidos');
  const baseFileName = `m${mesa}.txt`; // Nombre del archivo base solo con el encabezado
  const baseOutputPath = path.join(pedidosDir, baseFileName);

  // Leer el contenido original del archivo base para obtener el encabezado
  let headerContent = '';
  if (fs.existsSync(baseOutputPath)) {
    const fullBaseContent = fs.readFileSync(baseOutputPath, 'utf8');
    const baseLines = fullBaseContent.split('\n');
    const detalleIndex = baseLines.indexOf('/detalle');
    if (detalleIndex !== -1) {
      headerContent = baseLines.slice(0, detalleIndex + 1).join('\n'); // Incluye hasta /detalle
    } else {
      // Fallback si por alguna razón el archivo base no tiene /detalle (debería tenerlo)
      headerContent = `/header\n${String(mesa).padStart(2, '0')}\n${garzon}\n00\n${new Date().toLocaleTimeString().substring(0, 5).replace(':', ':')}\n/detalle\n`;
      console.warn(`Archivo base ${baseFileName} no tiene /detalle. Usando encabezado de fallback.`);
    }
  } else {
    return res.status(404).json({ error: `Archivo de comanda base ${baseFileName} para mesa ${mesa} no encontrado. Inicie la comanda primero.` });
  }

  // Generar el contenido del nuevo archivo TXT con la hora actual
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const timestampedFileName = `m${mesa}${hours}${minutes}.txt`; // Formato con hora y minuto
  const timestampedOutputPath = path.join(pedidosDir, timestampedFileName);

  let currentLineNumber = 1; // Reiniciar la numeración de línea para cada nuevo envío
  let newProductsContent = '';
  productos.forEach(item => {
    newProductsContent += `${currentLineNumber}\n`;
    newProductsContent += `${String(item.codigo).padStart(4, '0')}\n`;
    newProductsContent += `${item.cantidad}\n`;
    newProductsContent += `${item.precio}\n`;
    currentLineNumber++;
  });

  // Reconstruir el contenido final para el archivo timestamped: header + new products
  let finalTxtContent = `${headerContent}\n${newProductsContent.trimEnd()}`; // Asegurar que no haya dobles /detalle

  // Eliminar cualquier línea vacía extra que pudiera haber quedado al final del headerContent
  finalTxtContent = finalTxtContent.split('\n').filter(line => line.trim() !== '').join('\n');

  // Asegurar que termine con un solo salto de línea
  if (finalTxtContent.length > 0 && !finalTxtContent.endsWith('\n')) {
      finalTxtContent += '\n';
  }

  console.log(`Contenido TXT a escribir para mesa ${mesa} (${timestampedFileName}):\n${finalTxtContent}`); // Log con nombre de archivo

  fs.writeFileSync(timestampedOutputPath, finalTxtContent);
  console.log(`Archivo de comanda TXT para mesa ${mesa} (${timestampedFileName}) actualizado y listo para transferir.`);

  const transfer_cmd = [
    'c:/faster/pscp.exe',
    '-P', '10605',
    '-pw', '4600',
    timestampedOutputPath, // Usar el archivo timestamped para la transferencia
    'traspaso@faster.dyndns.org:/u/ffp/recep/pedidos/'
  ];

  execFile(transfer_cmd[0], transfer_cmd.slice(1), (error, stdout, stderr) => {
    // Borrar el archivo localmente después de la transferencia, ya que es un nuevo envío
    fs.unlinkSync(timestampedOutputPath);
    if (error) {
      console.error('Error al transferir archivo TXT de comanda:', stderr);
      return res.status(500).json({ error: 'Error al transferir archivo TXT de comanda', details: stderr });
    }
    console.log('SCP STDOUT:', stdout);
    console.log('SCP STDERR:', stderr);
    res.json({ ok: true, message: 'Comanda TXT transferida correctamente.' });
  });
});

// Eliminar una mesa (opcional)
app.delete('/mesas/:mesa', (req, res) => {
  const mesaId = req.params.mesa;
  if (!fs.existsSync(FILE)) return res.json({});
  let data = JSON.parse(fs.readFileSync(FILE, 'utf8') || '{}');
  delete data[mesaId];
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  res.json({ ok: true });
});

// Endpoint para emitir cuenta y transferir CSV por SSH
app.post('/emitir-cuenta', (req, res) => {
  const { mesa, garzon, total } = req.body;
  if (!mesa || !garzon || !total) return res.status(400).json({ error: 'Faltan datos' });

  // === Generar archivo de cuenta en formato TXT ===
  const cuentaTxtContent = `/cuenta\n${mesa}\n${total}\n`;

  const pedidosDir = path.join(__dirname, 'pedidos');
  if (!fs.existsSync(pedidosDir)) {
    fs.mkdirSync(pedidosDir, { recursive: true });
    console.log(`Directorio creado: ${pedidosDir}`);
  }

  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const fileName = `cm${mesa}${hours}${minutes}.txt`; // Nuevo formato de nombre de archivo
  const outputPath = path.join(pedidosDir, fileName);

  fs.writeFileSync(outputPath, cuentaTxtContent);
  console.log(`Archivo de cuenta TXT generado en: ${outputPath}`);

  // Comando pscp.exe para transferir el archivo de cuenta
  const transfer_cmd = [
    'c:/faster/pscp.exe',
    '-P', '10605',
    '-pw', '4600',
    outputPath,
    'traspaso@faster.dyndns.org:/u/ffp/recep/pedidos/'
  ];

  execFile(transfer_cmd[0], transfer_cmd.slice(1), (error, stdout, stderr) => {
    require('fs').unlinkSync(outputPath);
    if (error) {
      return res.status(500).json({ error: 'Error al transferir archivo', details: stderr });
    }
    res.json({ ok: true, message: 'Cuenta emitida y transferida correctamente.' });
  });
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
        const headers = ['codigo', 'nombre', 'precio', 'familia', 'subfamilia'];

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
  const remoteSourcePath = '/u/ffp/envio/productos.csv';
  const localDbDir = path.join(__dirname, '..', 'db'); // FASTER-POS-WEB/db
  const localProductsPath = path.join(localDbDir, 'productos.csv');

  // Asegurarse de que la carpeta local de destino exista
  if (!fs.existsSync(localDbDir)) {
    fs.mkdirSync(localDbDir, { recursive: true });
    console.log(`Directorio creado: ${localDbDir}`);
  }

  // Ya que se está usando -pw en otros comandos, asumimos que este también puede usarlo.
  const privateKeyArgs = ['-pw', '4600']; // Esto contendrá los argumentos de autenticación

  const scp_cmd = [
    'c:/faster/pscp.exe',
    '-P', '10605',
    ...privateKeyArgs, // Incluir los argumentos de autenticación aquí
    `traspaso@faster.dyndns.org:${remoteSourcePath}`,
    localProductsPath
  ];

  console.log(`Intentando descargar ${remoteSourcePath} a ${localProductsPath}...`);

  execFile(scp_cmd[0], scp_cmd.slice(1), (error, stdout, stderr) => {
    // === NUEVOS LOGS DE ESTADO DE COPIA ===
    if (stdout) {
      console.log('SCP STDOUT:', stdout);
    }
    if (stderr) {
      console.error('SCP STDERR:', stderr);
    }
    // ==================================

    if (error) {
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
    console.log(`productos.csv descargado y guardado en ${localProductsPath}`);
    res.json({ success: true, message: 'Base de productos actualizada correctamente.' });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
}); 