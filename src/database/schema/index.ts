import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  jsonb,
  boolean,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
  token: varchar("token", { length: 255 }),
  balance: integer("balance").notNull().default(0),
  alreadyCLaim: boolean().default(false),
  isActivated: boolean("is_activated").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const translations = pgTable("translations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "no action" }),
  payload: text("payload").notNull(),
  result: text("result").notNull(),
  usedToken: integer("used_token").notNull(),
  originalUsedToken: integer("original_used_token").notNull(),
  tokenDetail: jsonb("token_detail"),
  balance: integer("balance").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  translations: many(translations),
}));

export const translationsRelations = relations(translations, ({ one }) => ({
  user: one(users, {
    fields: [translations.userId],
    references: [users.id],
  }),
}));
