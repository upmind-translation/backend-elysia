import { Elysia } from "elysia";
import { authService } from "../services/auth.service";
import { UserModel } from "../database/models/user.model";
import { env } from "../env";

export const protectedRoute = new Elysia({ prefix: "/app" })
  .get("/profile", async (context: any) => {
    // user sudah dijamin ada oleh guard
    const { user } = context;

    // ambil info user dari database
    const loggedUser = await UserModel.findById(user.id);
    if (!loggedUser) {
      return {
        success: false,
        message: "User Notfound",
      };
    }

    return {
      id: loggedUser.id,
      email: loggedUser.email,
      token: loggedUser.token,
      alreadyCLaim: loggedUser.alreadyCLaim,
      balance: loggedUser.balance,
      createdAt: loggedUser.createdAt,
    };
  })
  .get("/generate-token", async (context: any) => {
    // user sudah dijamin ada oleh guard
    const { user } = context;
    const result = await authService.generateToken(user.id);
    return result;
  })
  .get("/claim-free-balance", async (context: any) => {
    // user sudah dijamin ada oleh guard
    const { user } = context;

    // ambil info user dari database
    const loggedUser = await UserModel.findById(user.id);
    if (!loggedUser || loggedUser.alreadyCLaim === true) {
      return {
        success: false,
        message: "User Notfound, or you already claim free balance",
      };
    }

    // set new balance
    const newBalance: number = Number(env.OPENAI_API_FREE_BALANCE);
    await UserModel.update(user.id, {
      balance: newBalance,
      alreadyCLaim: true,
    });

    return {
      id: loggedUser.id,
      email: loggedUser.email,
      token: loggedUser.token,
      balance: newBalance,
      createdAt: loggedUser.createdAt,
    };
  });
