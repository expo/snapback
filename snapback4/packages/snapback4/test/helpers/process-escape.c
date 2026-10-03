// A native escape fixture: the parent exits, the child retains its environment
// while leaving the original process group and closing all standard streams.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/wait.h>

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "sleep") == 0) {
    sleep(600);
    return 0;
  }
  if (argc != 3) return 2;
  pid_t child = fork();
  if (child < 0) return 3;
  if (child > 0) return 0;
  if (strcmp(argv[1], "setsid") == 0) {
    if (setsid() < 0) return 4;
  } else if (strcmp(argv[1], "setpgid") == 0) {
    if (setpgid(0, 0) < 0) return 5;
  } else return 6;
  int null = open("/dev/null", O_RDWR);
  if (null < 0) return 7;
  for (int fd = 0; fd < 3; fd++) if (dup2(null, fd) < 0) return 8;
  if (null > 2) close(null);
  FILE *file = fopen(argv[2], "w");
  if (!file) return 9;
  fprintf(file, "%d\n", getpid());
  fclose(file);
  sleep(600);
  return 0;
}
