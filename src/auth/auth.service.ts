import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service.js';
import { LoginDto } from './dto/login.dto.js';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation.js';
import { Role } from '../generated/prisma/enums.js';
import { RefreshTokenDto } from './dto/refresh-token.dto.js';
import { LogoutDto } from './dto/logout.dto.js';
import { UserService } from '../user/user.service.js';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService<EnvironmentVariables, true>,
    private userService: UserService
  ) {}

  async login(dto: LoginDto) {
    const user = await this.userService.findByEmail(dto.email)
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatched = await bcrypt.compare(dto.password, user.password);

    if (!passwordMatched) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return tokens;
  }

  async logout(dto:LogoutDto){
    let payload : {sub : string};

    try {
      payload = await this.jwtService.verifyAsync(dto.refreshToken, {
        secret : this.configService.get<string>('JWT_REFRESH_SECRET')
      })
    } catch{
      throw new UnauthorizedException("invalid refresh token")
    }


    const tokenHash = this.hashToken(dto.refreshToken)

    const stored = await this.prisma.refreshToken.findFirst({
      where : {
        userId : payload.sub,
        token : tokenHash,
        revoked : false
      }
    })

    if(!stored){
      throw new UnauthorizedException("Invalid refresh token")
    }

    await this.prisma.refreshToken.update({
      where : {id : stored.id},
      data : {revoked : true}
    })
  }

  async refreshTokens(dto: RefreshTokenDto) {
    let payload: { sub: string; email: string; role: Role };
    try {
      payload = await this.jwtService.verifyAsync(dto.refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const hashedToken = this.hashToken(dto.refreshToken);
    const { count } = await this.prisma.refreshToken.updateMany({
      where: {
        userId: payload.sub,
        token: hashedToken,
        revoked: false,
        expiresAt: { gt: new Date() },
      },
      data: { revoked: true },
    });

    if (count === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokens = await this.generateTokens(
      payload.sub,
      payload.email,
      payload.role,
    );
    await this.saveRefreshToken(payload.sub, tokens.refreshToken);

    return tokens;
  }

  private async generateTokens(userId: string, email: string, role: Role) {
    const payload = { sub: userId, email, role };

    const accessToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.configService.get<number>('JWT_ACCESS_EXPIRY'),
    });

    const refreshToken = await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get<number>('JWT_REFRESH_EXPIRY'),
    });

    return { accessToken, refreshToken };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private async saveRefreshToken(userId: string, refreshToken: string) {
    const hashedToken = this.hashToken(refreshToken);

    const expiresInSeconds =
      this.configService.get<number>('JWT_REFRESH_EXPIRY');

    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: hashedToken,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      },
    });
  }
}
