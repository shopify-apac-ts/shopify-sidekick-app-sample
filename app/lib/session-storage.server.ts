import { Session } from "@shopify/shopify-api";
import { getStore } from "./database.server";

export class SqliteSessionStorage {
  async storeSession(session: Session) {
    getStore().db.prepare("INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)").run(session.id, session.shop, JSON.stringify(session.toPropertyArray(true)));
    return true;
  }
  async loadSession(id: string) {
    const row = getStore().db.prepare("SELECT payload FROM sessions WHERE id = ?").get(id);
    return row ? Session.fromPropertyArray(JSON.parse(row.payload as string), true) : undefined;
  }
  async deleteSession(id: string) {
    getStore().db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
    return true;
  }
  async deleteSessions(ids: string[]) {
    for (const id of ids) await this.deleteSession(id);
    return true;
  }
  async findSessionsByShop(shop: string) {
    return getStore().db.prepare("SELECT payload FROM sessions WHERE shop = ?").all(shop)
      .map((row) => Session.fromPropertyArray(JSON.parse(row.payload as string), true));
  }
}
