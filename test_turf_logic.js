
import * as turf from '@turf/turf';

function calculateCentroid(type, coordinates) {
    if (type === 'Point') {
        return { lat: coordinates[1], lng: coordinates[0] };
    } else if (type === 'Polygon') {
        const polygon = turf.polygon(coordinates);
        const centroid = turf.centroid(polygon);
        return { 
            lat: centroid.geometry.coordinates[1], 
            lng: centroid.geometry.coordinates[0] 
        };
    }
    return null;
}

// Test Polygon (Square around Bangkok area)
const polyCoords = [[[100.5, 13.7], [100.6, 13.7], [100.6, 13.8], [100.5, 13.8], [100.5, 13.7]]];
const pointCoords = [100.55, 13.75];

console.log("Polygon Centroid:", calculateCentroid('Polygon', polyCoords));
console.log("Point Location:", calculateCentroid('Point', pointCoords));
