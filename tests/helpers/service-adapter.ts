import type { SupabaseClient } from "@supabase/supabase-js";
import type { PGlite } from "@electric-sql/pglite";

// Test-only PostgREST/Storage-shaped adapter around real PostgreSQL.
// It exercises worker orchestration, not live Supabase Auth/Storage HTTP behavior.
export function serviceAdapter(db: PGlite) {
  const objects = new Map<string, Buffer>();
  const sql = (identifier: string) => {
    if (!/^[a-z_]+$/.test(identifier))
      throw new Error("Unsafe test identifier");
    return `"${identifier}"`;
  };
  let mutex = Promise.resolve();
  async function execute<T>(fn: () => Promise<T>): Promise<T> {
    const result = mutex.then(async () => {
      await db.exec("savepoint adapter_query");
      try {
        const value = await fn();
        await db.exec("release savepoint adapter_query");
        return value;
      } catch (error) {
        await db.exec(
          "rollback to savepoint adapter_query; release savepoint adapter_query",
        );
        throw error;
      }
    });
    mutex = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      try {
        const data = await execute(async () => {
          const parameters: unknown[] = [];
          const entries = Object.entries(args).map(([key, value]) => {
            if (key === "warnings" && Array.isArray(value)) {
              const refs = value.map((v) => {
                parameters.push(v);
                return `$${parameters.length}`;
              });
              return `${sql(key)}=>ARRAY[${refs.join(",")}]::text[]`;
            }
            parameters.push(
              value && typeof value === "object"
                ? JSON.stringify(value)
                : value,
            );
            return `${sql(key)}=>$${parameters.length}`;
          });
          const result = await db.query<{ result: unknown }>(
            `select public.${sql(name)}(${entries.join(",")}) as result`,
            parameters,
          );
          return result.rows[0].result;
        });
        return { data, error: null };
      } catch (error) {
        return {
          data: null,
          error: {
            message: error instanceof Error ? error.message : "DB error",
          },
        };
      }
    },
    from: (table: string) => {
      let columns = "*";
      let values: Record<string, unknown> | null = null;
      const filters: [string, unknown][] = [];
      let order: string | null = null;
      let maximum: number | undefined;
      let single = false;
      const builder = {
        select: (value = "*") => {
          columns = value;
          return builder;
        },
        eq: (name: string, value: unknown) => {
          filters.push([name, value]);
          return builder;
        },
        order: (name: string, { ascending = true } = {}) => {
          order = `${sql(name)} ${ascending ? "asc" : "desc"}`;
          return builder;
        },
        limit: (value: number) => {
          maximum = value;
          return builder;
        },
        update: (value: Record<string, unknown>) => {
          values = value;
          return builder;
        },
        single: () => {
          single = true;
          return builder;
        },
        maybeSingle: () => {
          single = true;
          return builder;
        },
        then: async (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) => {
          try {
            const result = await execute(async () => {
              const args: unknown[] = [];
              let statement: string;
              if (values) {
                const assignments = Object.entries(values).map(
                  ([key, value]) => {
                    args.push(
                      value && typeof value === "object"
                        ? JSON.stringify(value)
                        : value,
                    );
                    return `${sql(key)}=$${args.length}`;
                  },
                );
                statement = `update public.${sql(table)} set ${assignments.join(",")}`;
              } else
                statement = `select ${columns === "*" ? "*" : columns.split(",").map(sql).join(",")} from public.${sql(table)}`;
              if (filters.length)
                statement +=
                  " where " +
                  filters
                    .map(([key, value]) => {
                      args.push(value);
                      return `${sql(key)}=$${args.length}`;
                    })
                    .join(" and ");
              if (values) statement += " returning *";
              else {
                if (order) statement += " order by " + order;
                if (maximum) statement += ` limit ${maximum}`;
              }
              return (await db.query<Record<string, unknown>>(statement, args))
                .rows;
            });
            return resolve({
              data: single ? (result[0] ?? null) : result,
              error: null,
            });
          } catch (error) {
            return resolve({
              data: null,
              error: {
                message: error instanceof Error ? error.message : "DB error",
              },
            });
          } finally {
            void reject;
          }
        },
      };
      return builder;
    },
    storage: {
      from: (bucket: string) => ({
        download: async (name: string) => {
          const bytes = objects.get(`${bucket}/${name}`);
          return bytes
            ? { data: new Blob([new Uint8Array(bytes)]), error: null }
            : { data: null, error: { message: "Missing test storage object" } };
        },
        upload: async (name: string, body: Uint8Array) => {
          const key = `${bucket}/${name}`;
          if (objects.has(key))
            return {
              data: null,
              error: { message: "Object already exists", statusCode: 409 },
            };
          objects.set(key, Buffer.from(body));
          await execute(() =>
            db.query(
              "insert into storage.objects(bucket_id,name) values($1,$2)",
              [bucket, name],
            ),
          );
          return { data: { path: name }, error: null };
        },
      }),
    },
  };
  return { client: client as unknown as SupabaseClient, objects };
}
