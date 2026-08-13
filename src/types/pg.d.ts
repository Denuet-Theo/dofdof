// `pg` n'embarque pas ses types et `@types/pg` n'est pas installé. Les scripts
// (`scripts/*.mjs`) s'en passaient : ils ne sont pas typés. La route d'export est
// le premier consommateur TypeScript du module, d'où cette déclaration.
//
// Elle décrit uniquement la surface réellement utilisée, plutôt qu'un
// `declare module 'pg'` qui rendrait tout `any` et laisserait passer une faute de
// frappe sur `query` ou un `rows` mal typé. Si `@types/pg` est ajouté un jour,
// supprimer ce fichier — les vrais types sont plus complets.
declare module 'pg' {
  export interface QueryResult<R> {
    rows: R[];
    rowCount: number | null;
  }

  export interface ClientConfig {
    connectionString?: string;
    ssl?: { rejectUnauthorized: boolean };
  }

  export class Client {
    constructor(config?: ClientConfig);
    connect(): Promise<void>;
    query<R = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<QueryResult<R>>;
    end(): Promise<void>;
  }

  const pg: { Client: typeof Client };
  export default pg;
}
