import { Controller, Get, Redirect, Session } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('login')
  @Redirect('/', 302)
  async login(@Session() session: Record<string, unknown>) {
    const { accessToken, username } = await this.authService.getSessionUser();
    session['user'] = { username, accessToken };
    return { url: process.env.FRONTEND_URL ?? 'http://localhost:3000' };
  }

  @Get('me')
  me(@Session() session: Record<string, unknown>) {
    const user = session['user'] as { username: string } | undefined;
    if (!user) return null;
    return { username: user.username };
  }

  @Get('logout')
  @Redirect('/', 302)
  logout(@Session() session: Record<string, unknown>) {
    delete session['user'];
    return { url: process.env.FRONTEND_URL ?? 'http://localhost:3000' };
  }
}
