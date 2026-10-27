import { Body, Controller, Get, Put } from '@nestjs/common';
import type { UserNutritionProfile, UserNutritionProfileInput } from '@foodlens/core';
import { CurrentUserId } from '../../common/current-user-id.decorator';
import { ProfileService } from './profile.service';
import { UserNutritionProfileInputPipe } from './user-nutrition-profile-input.pipe';

@Controller('profile')
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  /** 404, если пользователь ещё не прошёл onboarding. */
  @Get()
  get(@CurrentUserId() userId: string): Promise<UserNutritionProfile> {
    return this.profileService.getProfile(userId);
  }

  @Put()
  save(
    @CurrentUserId() userId: string,
    @Body(UserNutritionProfileInputPipe) input: UserNutritionProfileInput,
  ): Promise<UserNutritionProfile> {
    return this.profileService.saveProfile(userId, input);
  }
}
