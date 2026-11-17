// Орон зайн хэш (тор): "энэ цэгийн ойролцоо хэн байна вэ" гэдгийг хурдан олно.
// Физик алхам бүрт бүх NPC машин, явган хүн, тоглогч, тоглогчийн машиныг дахин бүртгэнэ.

export class SpatialHash {
  constructor(cellSize = 20) {
    this.cellSize = cellSize;
    /** @type {Map<number, object[]>} */
    this.cells = new Map();
  }

  key(ix, iz) {
    return (ix + 4096) * 8192 + (iz + 4096);
  }

  clear() {
    for (const list of this.cells.values()) list.length = 0;
  }

  /** @param {{x:number, z:number}} entry */
  insert(entry) {
    const key = this.key(Math.floor(entry.x / this.cellSize), Math.floor(entry.z / this.cellSize));
    let list = this.cells.get(key);
    if (!list) {
      list = [];
      this.cells.set(key, list);
    }
    list.push(entry);
  }

  /** Тойргийн доторх (ойролцоох нүднүүдийн) бүх бичлэгт callback дуудна. */
  query(x, z, radius, callback) {
    const size = this.cellSize;
    const minX = Math.floor((x - radius) / size);
    const maxX = Math.floor((x + radius) / size);
    const minZ = Math.floor((z - radius) / size);
    const maxZ = Math.floor((z + radius) / size);
    for (let ix = minX; ix <= maxX; ix++) {
      for (let iz = minZ; iz <= maxZ; iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (list) for (const entry of list) callback(entry);
      }
    }
  }
}
