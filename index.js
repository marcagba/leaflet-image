/* global L */

/* {{{ Utility functions */

function isDataURL(url) {
    /* eslint-disable-next-line no-useless-escape */
    const dataURLRegex = /^\s*data:([a-z]+\/[a-z]+(;[a-z\-]+\=[a-z\-]+)?)?(;base64)?,[a-z0-9\!\$\&\'\,\(\)\*\+\,\;\=\-\.\_\~\:\@\/\?\%\s]*\s*$/i
    return !!url.match(dataURLRegex)
}

const cacheBusterDate = +new Date()

function addCacheString(url) {
    // workaround for https://github.com/mapbox/leaflet-image/issues/84
    if (!url) return url
    // If it's a data URL we don't want to touch this.
    if (isDataURL(url) || url.indexOf('mapbox.com/styles/v1') !== -1) {
        return url
    }
    return url + (url.match(/\?/) ? '&' : '?') + 'cache=' + cacheBusterDate
}

/* }}} */
/* {{{  Tiles Layers related */

async function handleTileLayer(layer, {map, dimensions, dummycanvas}) {
    const canvas = document.createElement('canvas')

    canvas.width = dimensions.x
    canvas.height = dimensions.y

    const ctx = canvas.getContext('2d')
    const bounds = map.getPixelBounds()
    const zoom = map.getZoom()
    const tileSize = layer.options.tileSize

    const hasMapbox = !!L.mapbox
    if (
        zoom > layer.options.maxZoom ||
        zoom < layer.options.minZoom ||
        // mapbox.tileLayer
        (hasMapbox &&
            layer instanceof L.mapbox.tileLayer &&
            !layer.options.tiles)
    ) {
        return
    }

    const tileBounds = L.bounds(
        bounds.min.divideBy(tileSize)._floor(),
        bounds.max.divideBy(tileSize)._floor(),
    )
    const tiles = []
    // const tileQueue = new queue(1)
    for (let j = tileBounds.min.y; j <= tileBounds.max.y; j++) {
        for (let i = tileBounds.min.x; i <= tileBounds.max.x; i++) {
            tiles.push(new L.Point(i, j))
        }
    }

    async function canvasTile(tile, tilePos, tileSize) {
        return {
            img: tile,
            pos: tilePos,
            size: tileSize,
        }
    }

    function loadTile(url, tilePos, tileSize) {
        return new Promise((resolve, reject) => {
            const im = new Image()
            im.crossOrigin = ''
            im.onload = () => {
                resolve({
                    img: this,
                    pos: tilePos,
                    size: tileSize,
                })
            }
            im.onerror = e => {
                // use canvas instead of errorTileUrl if errorTileUrl get 404
                if (
                    layer.options.errorTileUrl != '' &&
                    e.target.errorCheck === undefined
                ) {
                    e.target.errorCheck = true
                    e.target.src = layer.options.errorTileUrl
                } else {
                    reject({
                        img: dummycanvas,
                        pos: tilePos,
                        size: tileSize,
                    })
                }
            }
            im.src = url
        })
    }

    // `L.TileLayer.Canvas` was removed in leaflet 1.0
    const isCanvasLayer =
        L.TileLayer.Canvas && layer instanceof L.TileLayer.Canvas
    const data = []
    for (const tilePoint of tiles) {
        const originalTilePoint = tilePoint.clone()

        if (layer._adjustTilePoint) {
            layer._adjustTilePoint(tilePoint)
        }

        const tilePos = originalTilePoint
            .scaleBy(new L.Point(tileSize, tileSize))
            .subtract(bounds.min)

        if (tilePoint.y >= 0) {
            if (isCanvasLayer) {
                const tile = layer._tiles[tilePoint.x + ':' + tilePoint.y]
                // tileQueue.defer(canvasTile, tile, tilePos, tileSize)
                data.push(await canvasTile(tile, tilePos, tileSize))
            } else {
                const url = addCacheString(layer.getTileUrl(tilePoint))
                // tileQueue.defer(loadTile, url, tilePos, tileSize)
                data.push(await loadTile(url, tilePos, tileSize))
            }
        }
    }

    // tileQueue.awaitAll(tileQueueFinish)
    function drawTile(d) {
        ctx.drawImage(
            d.img,
            Math.floor(d.pos.x),
            Math.floor(d.pos.y),
            d.size,
            d.size,
        )
    }
    data.forEach(drawTile)

    return { canvas }
}

async function handlePathRoot(root, {map, dimensions}) {
    const bounds = map.getPixelBounds()
    const origin = map.getPixelOrigin()
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.x
    canvas.height = dimensions.y
    const ctx = canvas.getContext('2d')
    const pos = L.DomUtil.getPosition(root)
        .subtract(bounds.min)
        .add(origin)
    try {
        ctx.drawImage(
            root,
            pos.x,
            pos.y,
            canvas.width - pos.x * 2,
            canvas.height - pos.y * 2,
        )
        return { canvas }
    } catch (e) {
        // eslint-disable-next-line no-console
        console.error('Element could not be drawn on canvas', root) 
        // throw new Error('Element could not be drawn on canvas', root) // eslint-disable-line no-console
    }
}

async function drawTileLayer(l, {map, dimensions, dummycanvas}) {
    if (l instanceof L.TileLayer) {
        // layerQueue.defer(handleTileLayer, l);
        return handleTileLayer(l, {map, dimensions, dummycanvas})
    } else if (l._heat) {
        // layerQueue.defer(handlePathRoot, l._canvas);
        return handlePathRoot(l._canvas, {map, dimensions})
    }
}

/* }}} */
/* {{{ Esri Dynamic layers related */

function handleEsriDymamicLayer(dynamicLayer, { dimensions }) {
    const canvas = document.createElement('canvas')
    canvas.width = dimensions.x
    canvas.height = dimensions.y

    const ctx = canvas.getContext('2d')
    return new Promise(resolve => {
        const im = new Image()
        im.crossOrigin = ''

        im.onload = () => {
            ctx.drawImage(im, 0, 0)
            resolve({ canvas })
        }
        im.src = addCacheString(dynamicLayer._currentImage._image.src)
    })
}

async function drawEsriDynamicLayer(l, {dimensions}) {
    if (!L.esri) return

    if (l instanceof L.esri.DynamicMapLayer) {
        // layerQueue.defer(handleEsriDymamicLayer, l)
        return handleEsriDymamicLayer(l, {dimensions})
    }
}

/* }}} */
/* {{{ Marrker layers */

function handleMarkerLayer(marker, {map, dimensions}) {
    const canvas = document.createElement('canvas'),
        ctx = canvas.getContext('2d'),
        pixelBounds = map.getPixelBounds(),
        minPoint = new L.Point(pixelBounds.min.x, pixelBounds.min.y),
        pixelPoint = map.project(marker.getLatLng()),
        /* eslint-disable-next-line no-useless-escape */
        isBase64 = /^data\:/.test(marker._icon.src),
        url = isBase64 ? marker._icon.src : addCacheString(marker._icon.src),
        im = new Image(),
        options = marker.options.icon.options
    let size = options.iconSize
    const pos = pixelPoint.subtract(minPoint),
        anchor = L.point(options.iconAnchor || (size && size.divideBy(2, true)))

    if (size instanceof L.Point) size = [size.x, size.y]

    const x = Math.round(pos.x - size[0] + anchor.x),
        y = Math.round(pos.y - anchor.y)

    canvas.width = dimensions.x
    canvas.height = dimensions.y

    im.crossOrigin = ''
    return new Promise(resolve => {
        im.onload = () => {
            ctx.drawImage(this, x, y, size[0], size[1])
            resolve({ canvas })
        }
        im.src = url

        if (isBase64) im.onload()
    })
}

function drawMarkerLayer(l, {map, dimensions}) {
    if (l instanceof L.Marker && l.options.icon instanceof L.Icon) {
        // layerQueue.defer(handleMarkerLayer, l)
        return handleMarkerLayer(l, {map, dimensions})
    }
}

/* }}} */

export default async function leafletImage(map) {
    const dimensions = map.getSize()
    // const layerQueue = new queue(1)

    const canvas = document.createElement('canvas')
    canvas.width = dimensions.x
    canvas.height = dimensions.y
    const ctx = canvas.getContext('2d')

    // dummy canvas image when loadTile get 404 error
    // and layer don't have errorTileUrl
    const dummycanvas = document.createElement('canvas')
    dummycanvas.width = 1
    dummycanvas.height = 1
    const dummyctx = dummycanvas.getContext('2d')
    dummyctx.fillStyle = 'rgba(0,0,0,0)'
    dummyctx.fillRect(0, 0, 1, 1)

    let layers = []
    map.eachLayer(l => layers.push(l))
    // layers are drawn in the same order as they are composed in the DOM:
    // tiles, paths, and then markers

    // map.eachLayer(drawTileLayer)
    // map.eachLayer(drawEsriDynamicLayer)
    const processedLayers = []
    const env = { map, dimensions, dummycanvas}
    for (const l of layers) {
        let tmp = await drawTileLayer(l, env)

        if (!tmp) {
            tmp = await drawEsriDynamicLayer(l, env)
        }
        if (tmp) {
            processedLayers.push(tmp)
        }
    }

    if (map._pathRoot) {
        processedLayers.push(await handlePathRoot(map._pathRoot, env))
    } else if (map._panes) {
        const firstCanvas = map._panes.overlayPane
            .getElementsByTagName('canvas')
            .item(0)
        if (firstCanvas) {
            processedLayers(await handlePathRoot(firstCanvas, env))
        }
    }

    for (const l of layers) {
        let tmp = await drawMarkerLayer(l, env)
        if (tmp) {
            processedLayers.push(tmp)
        }
    }

    // layerQueue.awaitAll(layersDone)
    processedLayers.forEach(layer => {
        if (layer && layer.canvas) {
            /* XXX: Which is the lightest: canvas or image ? To be known */
            ctx.drawImage(layer.canvas, 0, 0)
        }
    })

    return canvas
}
