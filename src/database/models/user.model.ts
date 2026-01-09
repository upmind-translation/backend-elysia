import { db } from "../client";
import { users } from "../schema";
import { eq } from "drizzle-orm";
import { User, NewUser, PublicUser } from "../type";

export const UserModel = {
  async create(data: NewUser): Promise<NewUser | undefined> {
    const [user] = await db.insert(users).values(data).returning();

    return user;
  },

  async findByEmail(email: string): Promise<User | undefined> {
    return await db.query.users.findFirst({
      where: eq(users.email, email),
    });
  },

  async findById(id: string): Promise<User | undefined> {
    return await db.query.users.findFirst({
      where: eq(users.id, id),
    });
  },

  async update(id: string, data: Partial<NewUser>): Promise<User | undefined> {
    try {
      // First check if user exists
      const existingUser = await this.findById(id);
      if (!existingUser) {
        return undefined;
      }

      const result = await db
        .update(users)
        .set(data)
        .where(eq(users.id, id))
        .returning();

      // If no rows were updated, return undefined
      if (!result || result.length === 0) {
        return undefined;
      }

      return result[0];
    } catch (error) {
      console.error("Error updating user:", error);
      throw error;
    }
  },

  async findByToken(token: string): Promise<User | undefined> {
    // Query langsung dengan token (karena token disimpan sebagai plain text)
    const user = await db.query.users.findFirst({
      where: eq(users.token, token),
    });

    // Jika user belum teraktivasi, anggap token tidak valid
    if (!user || user.isActivated === false) {
      return undefined;
    }

    return user;
  },

  toPublic(user: User | NewUser): PublicUser {
    const { password, token, balance, alreadyCLaim, deletedAt, ...safe } = user;
    return safe as PublicUser;
  },
};
