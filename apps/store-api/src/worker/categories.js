// Dung cay danh muc ("A / B / C") dung chung cho seed va publish. Dung theo full_path nen chay lai khong nhan doi.
const slugify = (s) => s.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/[\s_]+/g, '-') || 'x';

/** @param c pg client (trong transaction cua nguoi goi). resolve(parts) tra ve id danh muc la; created = so danh muc moi tao. */
export function createCategoryResolver(c) {
  const ids = new Map(); // full_path -> id
  const resolver = {
    created: 0,
    async resolve(parts) {
      let parent = null, path = '';
      for (const name of parts) {
        path = path ? `${path} / ${name}` : name;
        if (!ids.has(path)) {
          const r = await c.query(
            `insert into categories (parent_id, name, slug, full_path) values ($1, $2, $3, $4)
             on conflict (full_path) do update set full_path = excluded.full_path returning id, (xmax = 0) as inserted`,
            [parent, name, slugify(name), path]);
          ids.set(path, r.rows[0].id);
          if (r.rows[0].inserted) resolver.created++;
        }
        parent = ids.get(path);
      }
      return parent;
    },
  };
  return resolver;
}
