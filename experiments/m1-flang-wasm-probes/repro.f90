module m
  implicit none
  type :: base_t
    character(len=:), allocatable :: name
    real, allocatable :: params(:)
  end type
  type, extends(base_t) :: kid_t
    integer :: extra = 0
  end type
contains
  function mk(p, n) result(lbl)
    character(len=*), intent(in) :: p
    integer, intent(in) :: n
    character(len=:), allocatable :: lbl
    character(len=32) :: buf
    write(buf,'(i0)') n
    lbl = trim(p)//"-"//trim(buf)
  end function
end module

program repro
  use m
  implicit none
  type(base_t) :: a
  type(base_t), allocatable :: b
  class(base_t), allocatable :: c
  character(len=:), allocatable :: plain

  plain = mk("plain", 0)
  print '(a,a)', "A plain deferred-len local     : ", plain

  a%name = mk("A", 1)
  print '(a,a)', "B static type, char comp       : ", a%name
  a%params = [1.0, 2.0]
  print '(a,f6.2)', "C static type, array comp      : ", a%params(2)

  allocate(b)
  b%name = mk("B", 2)
  print '(a,a)', "D alloc static type, char comp : ", b%name
  b%params = [3.0]
  print '(a,f6.2)', "E alloc static type, arr comp  : ", b%params(1)

  allocate(base_t :: c)
  c%params = [9.0]
  print '(a,f6.2)', "F polymorphic, array comp      : ", c%params(1)
  c%name = mk("C", 3)
  print '(a,a)', "G polymorphic, char comp       : ", c%name
  deallocate(c)

  allocate(kid_t :: c)
  c%name = mk("D", 4)
  print '(a,a)', "H polymorphic ext, char comp   : ", c%name

  print '(a)', "REPRO-ALL-OK"
end program
