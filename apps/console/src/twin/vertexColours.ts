import { Color, Float32BufferAttribute } from 'three';

/**
 * `count` vertices all in one colour, in the linear space three's vertex colours are in: the colour attribute of the
 * boxes' faces and edges (V2-14.9) and of the buildings' faces (V2-15.5). `hex` is `#rrggbb`.
 */
export function filled(count: number, hex: string): Float32BufferAttribute {
  const color = new Color(hex);
  const array = new Float32Array(count * 3);
  for (let vertex = 0; vertex < count; vertex += 1) {
    array[3 * vertex] = color.r;
    array[3 * vertex + 1] = color.g;
    array[3 * vertex + 2] = color.b;
  }
  return new Float32BufferAttribute(array, 3);
}
