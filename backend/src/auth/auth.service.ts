import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface WikidataProfile {
  sub: string;
  username: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly config: ConfigService) {}

  async getSessionUser(): Promise<{ accessToken: string; username: string }> {
    const accessToken = this.config.get<string>('wikidata.accessToken');
    const profileURL = this.config.get<string>('wikidata.oauthProfileUrl')!;

    if (!accessToken) {
      throw new UnauthorizedException('WIKIDATA_OAUTH_ACCESS_TOKEN is not configured.');
    }

    try {
      const profileRes = await axios.get<WikidataProfile>(profileURL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      return { accessToken, username: profileRes.data.username };
    } catch (err) {
      this.logger.error(`Failed to fetch Wikidata profile: ${(err as Error).message}`);
      throw new UnauthorizedException('Access token is invalid or expired.');
    }
  }
}
